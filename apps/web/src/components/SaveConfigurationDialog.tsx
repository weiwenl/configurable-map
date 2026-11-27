import { useEffect, useRef, useState } from "react";
import './styles.css';

type Props = {
  isSaving: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
};

export default function SaveConfigurationDialog({ isSaving, error, onSave, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => { element.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className="configuration-dialog" aria-labelledby="save-configuration-heading" onCancel={event => { event.preventDefault(); if (!isSaving) onCancel(); }}>
      <form onSubmit={event => { event.preventDefault(); if (!isSaving && name.trim()) onSave(name.trim()); }}>
        <h2 id="save-configuration-heading">Save as configuration</h2>
        <p>Saves the current colour, size and column settings, then applies them.</p>
        <label>Configuration name<input autoFocus required maxLength={100} value={name} disabled={isSaving} onChange={event => setName(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="configuration-dialog-actions">
          <button type="button" disabled={isSaving} onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-action" disabled={isSaving || !name.trim()}>{isSaving ? "Saving…" : "Save configuration"}</button>
        </div>
      </form>
    </dialog>
  );
}
