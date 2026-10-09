// src/services/payslipPdfService.ts
//
// On-demand payslip PDF generation.
// Calls the generate-payslip-pdf Edge Function for a single payroll run.
// Returns a URL (temp on first generation, permanent on subsequent cached calls).

import { callEdge } from "../lib/edgeClient";

interface PayslipPdfResult {
  url: string;
  filename?: string;
  cached?: boolean;
  temporary?: boolean;
}

export const payslipPdfService = {
  /**
   * Generate (or retrieve cached) payslip PDF for a specific payroll run.
   * @param runId  - UUID of the payroll_runs row
   * @param forceRegenerate - If true, bypass cache and regenerate (default: false)
   * @returns Publicly accessible PDF URL
   */
  async generatePayslipPdf(
    runId: string,
    forceRegenerate = false,
  ): Promise<string> {
    const result = await callEdge<PayslipPdfResult>("generate-payslip-pdf", {
      runId,
      forceRegenerate,
    });
    if (!result?.url) throw new Error("No URL returned from payslip generator");
    return result.url;
  },
};
