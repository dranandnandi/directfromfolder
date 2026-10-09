-- Add pdf_url column to payroll_runs to cache generated payslip PDF URLs
-- Generated PDFs are stored in Supabase Storage bucket "payslips"
-- On-demand only: generated when user clicks the Payslip button per employee

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS pdf_url TEXT DEFAULT NULL;

COMMENT ON COLUMN payroll_runs.pdf_url IS
  'Permanent public URL of the generated payslip PDF stored in the payslips storage bucket. NULL means not yet generated.';
