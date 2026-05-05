import type { Metadata } from 'next';
import { listBrandAssets, RECOMMENDED_USE_CASES } from '@/lib/brand-assets';
import { getAllBrands } from '@/lib/brand';
import { BrandAssetsView } from '@/components/BrandAssetsView';

export const metadata: Metadata = { title: 'Brand Assets — Broadside' };
export const dynamic = 'force-dynamic';

export default async function BrandAssetsPage() {
  const [assets, brands] = await Promise.all([listBrandAssets({}), getAllBrands()]);

  return (
    <main className="mx-auto max-w-[80rem] px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.3em] text-[#6b6b7a] uppercase">
            Brand Library
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-[#e8e8f0]">Brand Assets</h1>
          <p className="mt-2 text-sm text-[#6b6b7a]">
            {assets.length} asset{assets.length === 1 ? '' : 's'} in the library. Curated, reusable images for posts, profiles, and templates.
          </p>
        </div>
      </header>

      <BrandAssetsView
        initialAssets={assets}
        brands={brands.map((b) => ({ id: b.id, slug: b.slug, name: b.name }))}
        useCases={[...RECOMMENDED_USE_CASES]}
      />
    </main>
  );
}
