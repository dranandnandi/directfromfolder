import { Link } from 'react-router-dom';
import { useStaffAccess } from '../../contexts/StaffAccessContext';
import DocumentManagement from './DocumentManagement';

export default function TrainingMaterials() {
  const { access } = useStaffAccess();
  if (!access) return null;
  return <div><Link to="/training" className="m-4 inline-block text-sm text-blue-700">← Training</Link><DocumentManagement organizationId={access.organization_id} userId={access.user_id} userName="Training manager" trainingOnly /></div>;
}
