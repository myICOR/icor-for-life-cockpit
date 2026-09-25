// InboxView.tsx - the `01 Inbox` room: Outer World captures (and their
// archive) and the Scanner Inbox, as a read-only folder tree with a docked
// preview. Nothing is uploaded or moved from here: capturing and filing
// happen in Obsidian and with the AI team.
import { useCallback, useState } from 'react';
import { Inbox } from 'lucide-react';
import { FolderTree, FilePreviewPanel } from '../components/FolderTree';
import { fileRouteSrc } from '../lib/router';
import { PageHeader } from '../components/PageHeader';

export function InboxView() {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const onFileOpen = useCallback((path: string) => setOpenPath(path), []);
  const onClose = useCallback(() => setOpenPath(null), []);

  return (
    <section className="ft-view animate-fade-rise">
      <PageHeader
        title="Inbox"
        icon={Inbox}
        subtitle="What has been handed over and not processed yet: web captures and scans."
      />
      <div className={openPath ? 'ft-layout ft-layout-split' : 'ft-layout'}>
        <FolderTree root="inbox" onFileOpen={onFileOpen} selectedPath={openPath} />
        {openPath && (
          <FilePreviewPanel
            path={openPath}
            fileUrl={`/api/file?path=${encodeURIComponent(openPath)}`}
            src={fileRouteSrc('file', openPath)}
            onClose={onClose}
          />
        )}
      </div>
    </section>
  );
}
