import React, { useState } from 'react';
import { supabase } from '../../utils/supabaseClient';
import dcpLogo from '/notification-icon.svg';

const LoginForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) throw signInError;
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <img src={dcpLogo} alt="DCP Logo" className="w-24 h-24 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">Clinic Task Manager</h2>
          <div className="h-1 w-20 bg-yellow-400 mx-auto my-4"></div>
          <p className="text-gray-600">Sign in to your account</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email address
            </label>
            <input
              type="email"
              required
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-yellow-400 focus:ring-yellow-400 transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-yellow-400 focus:ring-yellow-400 transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-3 px-4 rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 disabled:bg-gray-400 transition-colors font-medium"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          
          <div className="text-center text-sm text-gray-500 mt-8">
            <p>For login credentials or to create more users,</p>
            <p>please contact the <span className="text-black font-medium">Clinic Administrator</span></p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;