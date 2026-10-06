type Variant = 'primary' | 'secondary' | 'ghost' | 'plain'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonLook {
  readonly variant?: Variant
  readonly size?: Size
  readonly block?: boolean
}

export function buttonClass({ variant = 'primary', size = 'md', block = false }: ButtonLook, extra?: string): string {
  return ['ag-btn', `ag-btn--${variant}`, size !== 'md' && `ag-btn--${size}`, block && 'ag-btn--block', extra].filter(Boolean).join(' ')
}

