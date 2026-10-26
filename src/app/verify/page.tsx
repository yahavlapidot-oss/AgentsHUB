import { VerifyForm } from "@/components/verify-form";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only paths on this site, so the page can't be used to send you elsewhere.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <div className="grid min-h-[70vh] place-items-center p-4">
      <VerifyForm next={target} />
    </div>
  );
}
