" =======================
" Plugin Manager: vim-plug
" =======================
call plug#begin('~/.vim/plugged')

" Python syntax enhancements
Plug 'vim-python/python-syntax'

" ALE: Linting and formatting
Plug 'dense-analysis/ale'

" coc.nvim: Autocompletion + LSP
"Plug 'neoclide/coc.nvim', {'branch': 'release'}

" File explorer
Plug 'preservim/nerdtree'

" Git integration
Plug 'tpope/vim-fugitive'

" Status bar
Plug 'vim-airline/vim-airline'

" Commenting
Plug 'tpope/vim-commentary'

" color scheme
Plug 'morhetz/gruvbox'

call plug#end()

" =======================
" Basic Settings
" =======================
set tabstop=4
set shiftwidth=4
set expandtab
set smartindent
"set mouse=a
syntax on
filetype plugin indent on
set nolist  " disable visible tabs/trailing whitespace

" =======================
" Python Host (for plugins)
" =======================
let g:python3_host_prog = '/path/to/your/python3'

" =======================
" ALE Settings
" =======================
let g:ale_linters = {
\   'python': ['flake8', 'mypy'],
\}
let g:ale_fixers = {
\   'python': ['black', 'isort'],
\}
let g:ale_fix_on_save = 1
let g:airline#extensions#ale#enabled = 1

" =======================
" coc.nvim Settings
" =======================
" Disable Coc formatting on save
" Let ALE handle that
" (No autocmd CocAction format!)

" Completion (TAB)
inoremap <silent><expr> <Tab>
      \ pumvisible() ? "\<C-n>" :
      \ CheckBackspace() ? "\<Tab>" :
      \ coc#refresh()

function! CheckBackspace() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" Hover docs (K)
nnoremap <silent> K :call CocActionAsync('doHover')<CR>

" Go to definition (gd)
nmap <silent> gd <Plug>(coc-definition)

set background=dark
colorscheme gruvbox
