import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '../page';

const mockPush = vi.fn();
const mockSignIn = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    user: null,
    session: null,
    profile: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form with email and password fields', () => {
    render(<LoginPage />);

    expect(screen.getByText('Radar Report Platform')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('calls signIn and redirects to /dashboard on success', async () => {
    mockSignIn.mockResolvedValue({ error: null });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows error message on wrong password', async () => {
    mockSignIn.mockResolvedValue({ error: 'Invalid login credentials' });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(screen.getByText('邮箱或密码错误')).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows rate limit error message', async () => {
    mockSignIn.mockResolvedValue({ error: 'Rate limit exceeded' });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(screen.getByText('登录尝试过多，请稍后再试')).toBeInTheDocument();
    });
  });

  it('shows loading state while signing in', async () => {
    mockSignIn.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 100))
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByRole('button', { name: '登录中...' })).toBeDisabled();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows generic error on unexpected failure', async () => {
    mockSignIn.mockRejectedValue(new Error('Network error'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(screen.getByText('服务暂时不可用，请稍后重试')).toBeInTheDocument();
    });
  });
});
