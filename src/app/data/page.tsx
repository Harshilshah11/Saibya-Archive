import type { Metadata } from "next";
import { getDataIndex } from "@/lib/api";
import { parseFilters } from "@/lib/dataFilters";
import { DataBrowser } from "@/components/DataBrowser";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Data" };

export default async function DataPage({ searchParams }: PageProps<"/data">) {
  const initial = parseFilters(await searchParams);
  // Every session's per-stream sizes; searching, filtering and sorting happen in the browser.
  const { robots, rows } = await getDataIndex();

  return (
    <div className="space-y-5">
      <PageHeader title="Data" description="Find sessions across every robot and download them by data type." />
      <DataBrowser rows={rows} robots={robots} initial={initial} />
    </div>
  );
}
