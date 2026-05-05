import { getValidAccessToken } from './client';
import { getPool } from '@/lib/db/pool';
import { listMedia, getMediaFilePath } from '@/lib/media';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@/lib/logger';

const logger = createLogger('linkedin/publish');

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

interface PublishResult {
  linkedin_urn: string;
  posted_url: string;
}

/** Publish a post body to LinkedIn as the authenticated member. */
export async function publishToLinkedIn(postId: string): Promise<PublishResult> {
  const auth = await getValidAccessToken();
  if (!auth) throw new Error('LinkedIn not connected. Visit /settings to connect.');

  const pool = getPool();
  const { rows } = await pool.query<{ id: string; body: string; hashtags: string[]; status: string }>(
    `SELECT id, body, hashtags, status FROM posts WHERE id = $1 AND platform_id = 'linkedin'`,
    [postId],
  );
  if (rows.length === 0) throw new Error('LinkedIn post not found');
  const post = rows[0];

  if (post.status === 'posted') throw new Error('Post already published');

  // Build the body with hashtags appended
  let fullBody = post.body;
  if (post.hashtags && post.hashtags.length > 0) {
    const hashtagLine = post.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    fullBody = `${post.body}\n\n${hashtagLine}`;
  }

  // Check for images attached to the content group
  const { rows: postRow } = await pool.query<{ content_group_id: string }>(
    `SELECT content_group_id FROM posts WHERE id = $1`, [postId],
  );
  const groupId = postRow[0]?.content_group_id;
  let imageAssetUrn: string | null = null;

  if (groupId) {
    const mediaItems = await listMedia(groupId);
    const firstImage = mediaItems.find((m) => m.mime_type?.startsWith('image/'));
    if (firstImage) {
      try {
        // Step 1: Register an upload
        const registerRes = await fetch(`${LINKEDIN_API_BASE}/assets?action=registerUpload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
              owner: `urn:li:person:${auth.memberUrn}`,
              serviceRelationships: [{
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent',
              }],
            },
          }),
        });
        if (registerRes.ok) {
          const regData = await registerRes.json() as {
            value: {
              uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: string } };
              asset: string;
            };
          };
          const uploadUrl = regData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
          const assetUrn = regData.value.asset;

          // Step 2: Upload the image binary
          const imageData = await readFile(getMediaFilePath(firstImage));
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${auth.token}`,
              'Content-Type': firstImage.mime_type ?? 'image/jpeg',
            },
            body: imageData,
          });
          if (uploadRes.ok || uploadRes.status === 201) {
            imageAssetUrn = assetUrn;
            logger.log('uploaded image to LinkedIn:', assetUrn);
          } else {
            logger.logMinimal('LinkedIn image upload failed:', uploadRes.status);
          }
        } else {
          logger.logMinimal('LinkedIn register upload failed:', registerRes.status);
        }
      } catch (err) {
        logger.logMinimal('LinkedIn image attach failed:', (err as Error).message);
      }
    }
  }

  // LinkedIn UGC Posts API (works with w_member_social)
  const authorUrn = `urn:li:person:${auth.memberUrn}`;
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text: fullBody },
    shareMediaCategory: imageAssetUrn ? 'IMAGE' : 'NONE',
  };
  if (imageAssetUrn) {
    shareContent.media = [{
      status: 'READY',
      media: imageAssetUrn,
    }];
  }
  const payload = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': shareContent,
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const stop = logger.time('publish');
  const res = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(payload),
  });
  stop();

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LinkedIn publish failed: HTTP ${res.status} — ${errText.slice(0, 400)}`);
  }

  // The response header X-RestLi-Id contains the URN of the created post
  const linkedinUrn = res.headers.get('x-restli-id') ?? '';
  // Construct the public URL: activity URN → post URL
  const activityId = linkedinUrn.replace('urn:li:ugcPost:', '').replace('urn:li:share:', '');
  const postedUrl = activityId
    ? `https://www.linkedin.com/feed/update/${linkedinUrn}/`
    : '';

  // Update the post record
  const postedAt = new Date().toISOString();
  await pool.query(
    `UPDATE posts
        SET status = 'posted',
            posted_at = $1,
            posted_url = $2,
            linkedin_urn = $3
      WHERE id = $4`,
    [postedAt, postedUrl, linkedinUrn, postId],
  );

  // Update the content_group status if all sibling posts are now posted
  await pool.query(
    `UPDATE content_groups cg
        SET status = 'posted'
      WHERE cg.id = (SELECT content_group_id FROM posts WHERE id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM posts p
           WHERE p.content_group_id = cg.id AND p.status <> 'posted'
        )`,
    [postId],
  );

  logger.log('published to LinkedIn:', linkedinUrn, postedUrl);
  return { linkedin_urn: linkedinUrn, posted_url: postedUrl };
}
