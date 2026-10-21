import { useState, type MouseEvent, type ReactElement } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Box,
  Button,
  Divider,
  FormLabel,
  IconButton,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import LinkIcon from '@mui/icons-material/Link'
import RedoIcon from '@mui/icons-material/Redo'
import UndoIcon from '@mui/icons-material/Undo'
import { richTextSx } from '../lib/richText'

function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactElement
  active?: boolean
  disabled?: boolean
  onClick: (e: MouseEvent<HTMLElement>) => void
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          sx={{ borderRadius: 1, color: active ? 'primary.main' : 'text.secondary', bgcolor: active ? 'action.selected' : undefined }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )
}

function HeadingButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Tooltip title={label === 'H2' ? 'Heading' : 'Subheading'}>
      <Button
        size="small"
        aria-label={label === 'H2' ? 'Heading' : 'Subheading'}
        aria-pressed={active}
        onClick={onClick}
        sx={{ minWidth: 34, px: 0.75, color: active ? 'primary.main' : 'text.secondary', bgcolor: active ? 'action.selected' : undefined }}
      >
        {label}
      </Button>
    </Tooltip>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null)
  const [href, setHref] = useState('')
  const chain = () => editor.chain().focus()

  function openLink(anchor: HTMLElement) {
    setHref((editor.getAttributes('link').href as string | undefined) ?? '')
    setLinkAnchor(anchor)
  }

  function applyLink() {
    const url = href.trim()
    if (!url) chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run()
    setLinkAnchor(null)
  }

  return (
    <Stack
      direction="row"
      spacing={0.25}
      sx={{ px: 0.75, py: 0.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', alignItems: 'center' }}
    >
      <ToolButton label="Bold" icon={<FormatBoldIcon fontSize="small" />} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton label="Italic" icon={<FormatItalicIcon fontSize="small" />} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolButton label="Underline" icon={<FormatUnderlinedIcon fontSize="small" />} active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
      <HeadingButton label="H2" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <HeadingButton label="H3" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <ToolButton label="Bulleted list" icon={<FormatListBulletedIcon fontSize="small" />} active={state.bullets} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton label="Numbered list" icon={<FormatListNumberedIcon fontSize="small" />} active={state.numbers} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton label="Quote" icon={<FormatQuoteIcon fontSize="small" />} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
      <ToolButton label="Link" icon={<LinkIcon fontSize="small" />} active={state.link} onClick={(e) => openLink(e.currentTarget)} />
      <Box sx={{ flexGrow: 1 }} />
      <ToolButton label="Undo" icon={<UndoIcon fontSize="small" />} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <ToolButton label="Redo" icon={<RedoIcon fontSize="small" />} disabled={!state.canRedo} onClick={() => chain().redo().run()} />

      <Popover
        open={!!linkAnchor}
        anchorEl={linkAnchor}
        onClose={() => setLinkAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack
          component="form"
          direction="row"
          spacing={1}
          sx={{ p: 1.5, alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
        >
          <TextField
            label="Link URL"
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="https://"
            sx={{ width: 260 }}
          />
          <Button type="submit" variant="contained">
            {href.trim() ? 'Apply' : 'Remove'}
          </Button>
        </Stack>
      </Popover>
    </Stack>
  )
}

// The editor (TipTap) is heavy, so only the job form imports this file; the
// public page uses RichTextView.
//
// Mounts with `value` and reports changes; it doesn't follow `value` after
// that, so give it a `key` to reset it (e.g. when the loaded record changes).
export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
    ],
    content: value,
    editorProps: { attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  })
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? true })

  return (
    <Box>
      <FormLabel sx={{ display: 'block', mb: 0.75, typography: 'body2' }}>{label}</FormLabel>
      <Paper
        variant="outlined"
        sx={{
          overflow: 'hidden',
          '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` },
        }}
      >
        {editor && <Toolbar editor={editor} />}
        <Box
          sx={[
            richTextSx,
            {
              position: 'relative',
              '& .ProseMirror': { minHeight: 240, px: 2, py: 1.5, outline: 'none' },
              '& .ProseMirror > :first-of-type': { mt: 0 },
            },
          ]}
        >
          {empty && placeholder && (
            <Box
              aria-hidden
              sx={{ position: 'absolute', top: 12, left: 16, color: 'text.disabled', pointerEvents: 'none' }}
            >
              {placeholder}
            </Box>
          )}
          <EditorContent editor={editor} />
        </Box>
      </Paper>
    </Box>
  )
}
