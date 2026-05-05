/**
 * Minimal markdown → HTML converter used for email newsletter rendering.
 * Supports the small subset we use in Substack-length posts: headings,
 * bold/italic, inline code, lists, links, paragraphs.
 *
 * Not a full markdown parser — intentionally small and transparent so we can
 * reason about what ends up in an email.
 */
export function markdownToHtml(md: string): string {
  // Escape HTML first so user content can't inject tags
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html
    // Headings (h1-h3)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + italic, bold, italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Unordered / ordered list items
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive list items in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Links [text](url) — url is already HTML-escaped so &quot; etc. are safe
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Paragraphs: blank line → paragraph break
    .replace(/\n\n+/g, '</p><p>')
    // Single newlines → <br>
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

/** Wrap converted HTML in a minimal email-safe document shell. */
export function wrapEmailHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#222;max-width:640px;margin:0 auto;padding:24px;">
${bodyHtml}
</body></html>`;
}
