import type { Category, ProductDto } from '@estoicos/shared';
import { Boxes } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BulkPriceDialog } from '@/components/catalog/bulk-price-dialog';
import { CategoryDialog } from '@/components/catalog/category-dialog';
import { PageTitle } from '@/components/panel/coming-soon';
import { Button } from '@/components/ui/button';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { currentBranch } from '@/lib/branch';
import { ProductDialog } from './product-dialog';
import { ProductsTable } from './products-table';

export const metadata: Metadata = { title: 'Productos y Stock' };

export default async function ProductsPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const [{ data: products }, { data: categories }, branch] = await Promise.all([
    serverApi<ProductDto[]>('/v1/products?includeArchived=true'),
    serverApi<Category[]>('/v1/product-categories'),
    currentBranch(me),
  ]);
  const canManage = can(me, 'catalog:manage');
  const list = products ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageTitle
        title="Productos y Stock"
        description="Productos a la venta con su precio por sucursal. El stock, las compras y las alertas están en “Stock”."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/admin/productos/stock">
                  <Boxes /> Stock
                </Link>
              </Button>
              <CategoryDialog kind="product" categories={categories ?? []} />
              <BulkPriceDialog kind="product" items={list.filter((x) => x.active && !x.archived)} />
              <ProductDialog categories={categories ?? []} />
            </div>
          ) : (
            <Button asChild variant="outline">
              <Link href="/admin/productos/stock">
                <Boxes /> Stock
              </Link>
            </Button>
          )
        }
      />
      <ProductsTable
        products={list}
        categories={categories ?? []}
        branch={branch}
        canManage={canManage}
        canBranchPrices={can(me, 'catalog:branch-prices')}
      />
    </div>
  );
}
