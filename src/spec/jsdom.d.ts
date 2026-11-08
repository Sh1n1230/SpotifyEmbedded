/** spec で使う範囲だけの型（@types/jsdom を足さないため）。 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { contentType?: string });
  }
}
