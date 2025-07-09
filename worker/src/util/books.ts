import type { Book, BookData, Context } from '../types';

// loaded by esbuild
const EMBED_BOOK_DATA: BookData[] = process.env.EMBED_BOOKS as unknown as BookData[];

// eslint-disable-next-line no-underscore-dangle
let _books: Book[];
export const getBooks = (ctx: Context) => {
  if (_books) return _books;
  _books = EMBED_BOOK_DATA.map((bookData) => {
    const book: Book = {
      ...bookData,
      match(this: Book, path) {
        let matchPath = this.path;
        if (ctx.env.DOC_REPO_ROOT_PATH && this.path.startsWith(ctx.env.DOC_REPO_ROOT_PATH)) {
          matchPath = this.path.substring(ctx.env.DOC_REPO_ROOT_PATH.length);
        }
        matchPath = `${ctx.env.BASE_PATH || ''}${matchPath}`;
        return path.startsWith(matchPath);
      },
      resolve(this: Book, relPath) {
        return `${ctx.env.BASE_PATH || ''}${this.path}${relPath}`;
      },
    };
    return book;
  });
  return _books;
};

export const findBook = (path: string, ctx: Context): Book | undefined => {
  const books = getBooks(ctx);
  return books.find((one) => one.match(path));
};

export const resolvePath = (path: string, ctx: Context): string | undefined => {
  const book = findBook(path, ctx);
  if (!book) return undefined;
  return book.resolve(path);
};

export const resolveTopicPath = (path: string, ctx: Context): string | undefined => {
  const book = findBook(path, ctx);
  if (!book) {
    return '';
  }
  return `${ctx.env.DOC_REPO_ROOT_PATH || ''}${path}`.split(book.path)[1];
};

export const resolveAttributes = (path: string, ctx: Context): Record<string, string> => {
  const book = findBook(path, ctx);
  if (!book) return {};
  return book.attributes || {};
};
