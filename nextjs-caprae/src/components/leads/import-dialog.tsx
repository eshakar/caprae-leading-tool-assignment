"use client";

import { CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type ImportResult, isLeadDataKey, leadsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const SAMPLE_CSV =
  "company,website,industry,city,state,employees,revenue,founded,owner,email\n" +
  "Acme Plumbing,acmeplumbing.com,Plumbing,Austin,TX,25,$4M,1992,Jane Doe,jane@acmeplumbing.com\n";

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset(next: boolean) {
    if (!next) {
      setFile(null);
      setResult(null);
    }
    onOpenChange(next);
  }

  function pick(f: File | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please choose a .csv file");
      return;
    }
    setFile(f);
    setResult(null);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await leadsApi.importCsv(file);
      setResult(r);
      toast.success(`Imported ${r.created} new, merged ${r.merged} duplicates`);
      await mutate(isLeadDataKey);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Columns are mapped automatically (company, website, industry, state, employees, revenue, owner, email…).
            Duplicates are merged, not doubled.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            {file ? <FileSpreadsheet className="size-8 text-primary" /> : <UploadCloud className="size-8 text-muted-foreground" />}
            <span className="text-sm font-medium">{file ? file.name : "Drop a CSV here or click to browse"}</span>
            <span className="text-xs text-muted-foreground">
              {file ? `${(file.size / 1024).toFixed(1)} KB` : "Up to 5,000 rows / 5 MB"}
            </span>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </button>
        ) : (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-5 text-success" /> Import complete
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Created", result.created],
                ["Merged", result.merged],
                ["Skipped", result.skipped],
              ].map(([label, n]) => (
                <div key={label} className="rounded-lg bg-muted/60 p-2">
                  <div className="text-xl font-semibold tabular">{n}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Mapped columns: {Object.entries(result.columns_mapped).map(([k, v]) => `${v} → ${k}`).join(", ")}
            </p>
            {result.errors.length > 0 && (
              <ul className="max-h-24 list-disc overflow-auto pl-5 text-xs text-muted-foreground">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Tip: select the new leads in the table and click “Enrich” to crawl them.</p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="link" asChild className="px-0">
            <a href={sampleHref} download="saasquatch-sample.csv">
              Download sample CSV
            </a>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => reset(false)}>
              {result ? "Done" : "Cancel"}
            </Button>
            {!result && (
              <Button onClick={upload} disabled={!file || busy}>
                {busy && <Loader2 className="animate-spin" />}
                Import
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
