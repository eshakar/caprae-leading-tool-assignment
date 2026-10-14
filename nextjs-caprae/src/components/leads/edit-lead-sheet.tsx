"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type Lead, leadsApi } from "@/lib/api";
import { parseCompactNumber } from "@/lib/format";

const FIELDS: { name: keyof Lead; label: string; placeholder?: string; type?: "number" | "money" }[] = [
  { name: "company_name", label: "Company name" },
  { name: "domain", label: "Website", placeholder: "acme.com" },
  { name: "industry", label: "Industry", placeholder: "HVAC" },
  { name: "city", label: "City" },
  { name: "state", label: "State", placeholder: "TX" },
  { name: "employee_count", label: "Employees", type: "number" },
  { name: "revenue_usd", label: "Annual revenue", placeholder: "4.5M", type: "money" },
  { name: "founded_year", label: "Founded (year)", type: "number" },
  { name: "owner_name", label: "Owner / decision maker" },
  { name: "owner_title", label: "Title" },
  { name: "phone", label: "Phone" },
  { name: "linkedin_url", label: "LinkedIn URL" },
];

export function EditLeadSheet({
  lead,
  open,
  onOpenChange,
  onSaved,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (lead: Lead) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | number | null> = {};
    for (const f of FIELDS) {
      const raw = String(fd.get(f.name) ?? "").trim();
      if (f.type === "money") {
        const n = parseCompactNumber(raw);
        if (raw && n === null) {
          toast.error(`${f.label}: use a number like 4500000 or 4.5M`);
          return;
        }
        body[f.name] = n;
      } else if (f.type === "number") {
        body[f.name] = raw ? Number(raw) : null;
        if (raw && Number.isNaN(body[f.name])) {
          toast.error(`${f.label} must be a number`);
          return;
        }
      } else {
        body[f.name] = raw || null;
      }
    }
    setSaving(true);
    try {
      const updated = await leadsApi.update(lead.id, body as Partial<Lead>);
      toast.success(`Saved · score ${lead.score} → ${updated.score}`);
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit company details</SheetTitle>
          <SheetDescription>Better data means a more accurate Deal Signal Score. The lead is rescored when you save.</SheetDescription>
        </SheetHeader>
        <form id="edit-lead" onSubmit={onSubmit} className="grid gap-3 px-4" key={lead.updated_at}>
          {FIELDS.map((f) => (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              <Input
                id={`f-${f.name}`}
                name={f.name}
                defaultValue={(lead[f.name] as string | number | null) ?? ""}
                placeholder={f.placeholder}
                inputMode={f.type === "number" ? "numeric" : undefined}
              />
            </div>
          ))}
        </form>
        <SheetFooter>
          <Button type="submit" form="edit-lead" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Save & rescore
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
