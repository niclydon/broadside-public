'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TurndownService from 'turndown';
import { useCallback } from 'react';

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
td.addRule('lineBreak', {
  filter: 'br',
  replacement: () => '\n',
});

interface Props {
  initialHtml: string;
  onChange: (html: string, markdown: string) => void;
  placeholder?: string;
  supportsImages: boolean;
}

export function RichEditor({ initialHtml, onChange, placeholder, supportsImages }: Props) {
  const handleUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      const html = editor.getHTML();
      const markdown = td.turndown(html);
      onChange(html, markdown);
    },
    [onChange],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      ...(supportsImages ? [Image.configure({ inline: false })] : []),
      Placeholder.configure({ placeholder: placeholder ?? 'Start writing…' }),
    ],
    content: initialHtml || '',
    onUpdate: handleUpdate,
    editorProps: {
      attributes: { class: 'rich-editor-content' },
    },
  });

  const insertLink = () => {
    if (!editor) return;
    const url = window.prompt('URL:');
    if (!url) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      editor.chain().focus().insertContent(`<a href="${url}">${url}</a>`).run();
    }
  };

  const insertImage = () => {
    if (!editor) return;
    const url = window.prompt('Image URL:');
    if (!url) return;
    const alt = window.prompt('Alt text (optional):') ?? '';
    editor.chain().focus().setImage({ src: url, alt }).run();
  };

  if (!editor) return null;

  const btn = (active: boolean) =>
    `rich-toolbar-btn${active ? ' rich-toolbar-btn--active' : ''}`;

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" className={btn(editor.isActive('bold'))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }} title="Bold">B</button>
        <button type="button" className={btn(editor.isActive('italic'))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }} title="Italic"><em>I</em></button>
        <button type="button" className={btn(editor.isActive('heading', { level: 2 }))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }} title="Heading 2">H2</button>
        <button type="button" className={btn(editor.isActive('heading', { level: 3 }))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }} title="Heading 3">H3</button>
        <button type="button" className={btn(editor.isActive('bulletList'))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }} title="Bullet list">•–</button>
        <button type="button" className={btn(editor.isActive('orderedList'))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }} title="Ordered list">1–</button>
        <button type="button" className={btn(editor.isActive('code'))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }} title="Inline code">`c`</button>
        <button type="button" className={btn(editor.isActive('codeBlock'))} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCodeBlock().run(); }} title="Code block">```</button>
        <div className="rich-toolbar-sep" />
        <button type="button" className={btn(editor.isActive('link'))} onMouseDown={(e) => { e.preventDefault(); if (editor.isActive('link')) { editor.chain().focus().unsetLink().run(); } else { insertLink(); } }} title="Link">🔗</button>
        {supportsImages && (
          <button type="button" className={btn(false)} onMouseDown={(e) => { e.preventDefault(); insertImage(); }} title="Image">🖼</button>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
