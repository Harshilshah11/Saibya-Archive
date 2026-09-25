import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <span className="brand-mark mb-4 h-10 text-faint" aria-hidden />
      <h1 className="text-xl font-semibold">Not in the archive</h1>
      <p className="mt-1 text-sm text-muted">That robot or session has no files in the bucket.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
        Back to robots
      </Link>
    </div>
  );
}
