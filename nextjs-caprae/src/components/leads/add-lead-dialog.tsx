"use client";

import { Globe, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isLeadDataKey, leadsApi } from "@/lib/api";

export function AddLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [submitting, setSubmitting] = useState(false);
  const [autoEnrich, setAutoEnrich] = useState(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      domain: String(fd.get("domain") ?? "").trim() || undefined,
      company_name: String(fd.get("company_name") ?? "").trim() || undefined,
      industry: String(fd.get("industry") ?? "").trim() || undefined,
      state: String(fd.get("state") ?? "").trim() || undefined,
      owner_name: String(fd.get("owner_name") ?? "").trim() || undefined,
      email: String(fd.get("email") ?? "").trim() || undefined,
      auto_enrich: autoEnrich,
    };
    if (!body.domain && !body.company_name) {
      toast.error("Add a website or a company name");
      return;
    }
    setSubmitting(true);
    const t = toast.loading(autoEnrich && body.domain ? "Crawling website, verifying emails, scoring…" : "Saving lead…");
    try {
      const lead = await leadsApi.create(body);
      toast.success(`${lead.company_name} added · score ${lead.score}`, { id: t });
      await mutate(isLeadDataKey);
      onOpenChange(false);
      router.push(`/leads/${lead.id}`);
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>
            Paste a website and we&apos;ll do the rest: crawl it for contacts and deal signals, verify emails and score it.
          </DialogDescription>
        </DialogHeader>
        <form id="add-lead" onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="domain">Website</Label>
            <div className="relative">
              <Globe className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="domain" name="domain" placeholder="acmeplumbing.com" className="pl-8" autoFocus autoComplete="off" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="company_name">Company name</Label>
              <Input id="company_name" name="company_name" placeholder="Detected automatically" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" name="industry" placeholder="e.g. HVAC" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" placeholder="TX" maxLength={30} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="owner_name">Owner / contact</Label>
              <Input id="owner_name" name="owner_name" placeholder="Optional" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Known email</Label>
            <Input id="email" name="email" type="email" placeholder="Optional - we'll verify it" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={autoEnrich} onCheckedChange={(v) => setAutoEnrich(v === true)} />
            <Sparkles className="size-3.5 text-primary" />
            Enrich from website right away
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="add-lead" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Add lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
