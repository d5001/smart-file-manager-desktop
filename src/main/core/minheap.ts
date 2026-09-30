/** 定长最小堆 —— 用于在 O(n log k) 内维护「最大的 k 个文件"，避免把海量文件全量驻留内存 */
export class MinHeap<T> {
  private items: T[] = [];

  constructor(
    private readonly capacity: number,
    private readonly score: (item: T) => number
  ) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    if (this.capacity <= 0) return;
    if (this.items.length < this.capacity) {
      this.items.push(item);
      this.bubbleUp(this.items.length - 1);
      return;
    }
    if (this.score(item) <= this.score(this.items[0])) return;
    this.items[0] = item;
    this.sinkDown(0);
  }

  /** 返回按 score 降序排列的全部元素 */
  drainDesc(): T[] {
    return [...this.items].sort((a, b) => this.score(b) - this.score(a));
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score(this.items[parent]) <= this.score(this.items[i])) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  private sinkDown(index: number): void {
    let i = index;
    const n = this.items.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.score(this.items[left]) < this.score(this.items[smallest])) smallest = left;
      if (right < n && this.score(this.items[right]) < this.score(this.items[smallest])) smallest = right;
      if (smallest === i) break;
      [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
      i = smallest;
    }
  }
}
