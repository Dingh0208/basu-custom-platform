type ToastProps = { message: string | null };

export default function Toast({ message }: ToastProps) {
  return (
    <div className={`toast ${message ? 'show' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
