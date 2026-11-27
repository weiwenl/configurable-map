import { useEffect, useRef, useState } from "react";
import { publishConfiguration } from "../configurationApi";
import "./styles.css";

type Props = { configurationId: string; name: string; onClose: () => void };

export default function ShareConfigurationDialog({ configurationId, name, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => { element.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);

  const publish = async () => {
    setIsPublishing(true);
    setError(null);
    try {
      const { token } = await publishConfiguration(configurationId);
      if (!token) throw new Error("The service did not return a share link. Try again.");
      setUrl(`${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(token)}`);
    } catch (error) { setError((error as Error).message); }
    finally { setIsPublishing(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopyStatus("Copied"); }
    catch { setCopyStatus("Could not copy automatically. Select the link and copy it manually."); }
  };

  return <dialog ref={dialog} className="configuration-dialog" aria-labelledby="share-configuration-heading" onCancel={event => { event.preventDefault(); if (!isPublishing) onClose(); }}>
    <h2 id="share-configuration-heading">Share {name}</h2>
    <p>Anyone with this link can view these saved settings. Unsaved edits are not included.</p>
    {error && <p role="alert">{error}</p>}
    {url && <>
      <label>Share link<input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </>}
    <div className="configuration-dialog-actions">
      <button type="button" disabled={isPublishing} onClick={onClose}>Close</button>
      {url ? <button type="button" onClick={() => void copy()}>Copy link</button> : <button type="button" className="primary-action" disabled={isPublishing} onClick={() => void publish()}>{isPublishing ? "Publishing…" : "Publish link"}</button>}
    </div>
  </dialog>;
}
