export interface User {
  id: string;
  organization_id: string;
  name: string;
  whatsapp_number: string;
  role: string;
  department: string;
  created_at?: Date;
  updated_at?: Date;
}
