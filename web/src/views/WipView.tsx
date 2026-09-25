// WipView.tsx - browse `03 WiP` (Workstreams, AI Team, Projects, Operations)
// as a folder tree with a docked preview. `_archive` stays hidden. Read-only:
// the tree is GET /api/tree?root=wip and a preview is GET /api/file (jailed,
// 2 MB cap for text, inert no-script CSP).
import { useCallback, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { FolderTree, FilePreviewPanel } from '../components/FolderTree';
import { fileRouteSrc } from '../lib/router';
import { PageHeader } from '../components/PageHeader';

export function WipView() {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const onFileOpen = useCallback((path: string) => setOpenPath(path), []);
  const onClose = useCallback(() => setOpenPath(null), []);

  return (
    <section className="ft-view animate-fade-rise">
      <PageHeader
        title="Work in progress"
        icon={FolderOpen}
        subtitle="What is being worked on right now. Click a file to preview it; edit it in Obsidian."
      />
      <div className={openPath ? 'ft-layout ft-layout-split' : 'ft-layout'}>
        <FolderTree root="wip" onFileOpen={onFileOpen} selectedPath={openPath} />
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
