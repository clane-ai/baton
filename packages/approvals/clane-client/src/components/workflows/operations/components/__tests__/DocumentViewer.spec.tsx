import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import { I18nProvider } from '../../../../../i18n';

import { DocumentViewer } from '../DocumentViewer';
import type { DocumentRef } from '../../data/types';

// Render inside the platform's i18n provider, as the section is in the app.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

const email: DocumentRef = {
  id: 'd1',
  label: 'Requester email',
  path: 'inbox/requisitions/PR-2026-103.eml',
  type: 'email',
  from: 'convention',
  kind: 'purchase_order',
  available: true,
};
const missingPdf: DocumentRef = {
  id: 'd2',
  label: 'Requisition',
  path: 'inbox/requisitions/PR-2026-103.pdf',
  type: 'pdf',
  from: 'convention',
  kind: 'purchase_order',
  available: false,
};
const pdf: DocumentRef = { ...missingPdf, id: 'd3', available: true };

const EML = [
  'From: Priya Raman <priya@example.com>',
  'To: buying@example.com',
  'Subject: Requisition PR-2026-103',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Please order three rack servers.',
].join('\r\n');

beforeAll(() => {
  Object.assign(URL, {
    createObjectURL: jest.fn(() => 'blob:pdf-1'),
    revokeObjectURL: jest.fn(),
  });
});

describe('DocumentViewer', () => {
  it('opens on the first document and shows the parsed email', async () => {
    const textOf = jest.fn(() => Promise.resolve(EML));
    render(<DocumentViewer itemKey="TSK-1" docs={[email, missingPdf]} textOf={textOf} blobOf={jest.fn()} />);
    expect(await screen.findByText('Requisition PR-2026-103')).toBeInTheDocument();
    expect(screen.getByText('Please order three rack servers.')).toBeInTheDocument();
    expect(textOf).toHaveBeenCalledWith(email);
  });

  it('shows a document the workspace does not hold as a disabled tab', async () => {
    const textOf = jest.fn(() => Promise.resolve(EML));
    render(<DocumentViewer itemKey="TSK-1" docs={[email, missingPdf]} textOf={textOf} blobOf={jest.fn()} />);
    const tab = screen.getByRole('tab', { name: /Requisition/ });
    expect(tab).toBeDisabled();
    expect(within(tab).getByText('Not uploaded')).toBeInTheDocument();
    fireEvent.click(tab);
    await screen.findByText('Requisition PR-2026-103');
    expect(textOf).not.toHaveBeenCalledWith(missingPdf);
  });

  it('shows a PDF from an authenticated blob, never a bare URL', async () => {
    const blobOf = jest.fn(() => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })));
    render(<DocumentViewer itemKey="TSK-1" docs={[pdf]} textOf={jest.fn()} blobOf={blobOf} />);
    await waitFor(() => expect(screen.getByTitle('Requisition')).toHaveAttribute('src', 'blob:pdf-1'));
    expect(blobOf).toHaveBeenCalledWith(pdf);
  });

  it('says so when none of the documents are in the workspace', () => {
    render(<DocumentViewer itemKey="TSK-1" docs={[missingPdf]} textOf={jest.fn()} blobOf={jest.fn()} />);
    expect(screen.getByText('None of these documents are in the workspace yet')).toBeInTheDocument();
  });

  it('says so when the step names no documents', () => {
    render(<DocumentViewer itemKey="TSK-1" docs={[]} textOf={jest.fn()} blobOf={jest.fn()} />);
    expect(screen.getByText('No source documents for this step')).toBeInTheDocument();
  });

  it('reports a document that fails to load', async () => {
    const textOf = jest.fn(() => Promise.reject(new Error('Baton is unreachable')));
    render(<DocumentViewer itemKey="TSK-1" docs={[email]} textOf={textOf} blobOf={jest.fn()} />);
    expect(await screen.findByText(/Baton is unreachable/)).toBeInTheDocument();
  });
});
