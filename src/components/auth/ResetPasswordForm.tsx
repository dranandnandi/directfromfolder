import { useState } from 'react';
import { supabase } from '../../utils/supabaseClient';
import dcpLogo from '/notification-icon.svg';

interface ResetPasswordFormProps {
  onComplete: () => void;
}

const ResetPasswordForm = ({ onComplete }: ResetPasswordFormProps) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
  };

  const returnToLogin = async () => {
    await supabase.auth.signOut();
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <img src={dcpLogo} alt="DCP Logo" className="w-24 h-24 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">Set a new password</h2>
          <div className="h-1 w-20 bg-yellow-400 mx-auto my-4"></div>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">{error}</div>}

        {success ? (
          <div className="space-y-5">
            <div className="bg-green-50 text-green-700 p-4 rounded-lg">
              Your password has been updated.
            </div>
            <button
              type="button"
              onClick={returnToLogin}
              className="w-full bg-black text-white py-3 px-4 rounded-lg hover:bg-gray-800"
            >
              Return to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-yellow-400 focus:ring-yellow-400"
              placeholder="New password"
            />
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-yellow-400 focus:ring-yellow-400"
              placeholder="Confirm new password"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white py-3 px-4 rounded-lg hover:bg-gray-800 disabled:bg-gray-400"
            >
              {loading ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordForm;
