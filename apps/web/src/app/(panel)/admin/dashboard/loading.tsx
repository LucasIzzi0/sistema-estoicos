import { PageSkeleton } from '@/components/panel/skeletons';

export default function Loading() {
  return <PageSkeleton stats={4} blocks={2} />;
}
