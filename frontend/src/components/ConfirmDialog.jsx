import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ dialog, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (dialog && el && !el.open) el.showModal();
    if (!dialog && el?.open) el.close();
  }, [dialog]);

  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose(false); }}>
      {dialog && (
        <>
          <h3>{dialog.title}</h3>
          <div className="dialog-body">{dialog.message}</div>
          <div className="actions end">
            <button type="button" className="btn ghost" onClick={() => onClose(false)} autoFocus>Cancel</button>
            <button type="button" className={`btn ${dialog.danger ? 'danger solid' : 'primary'}`} onClick={() => onClose(true)}>
              {dialog.confirmLabel || 'Confirm'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
