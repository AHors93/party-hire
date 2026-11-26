// Tiny JSON-file store. Plenty for a side business with a handful of bookings a week.
import fs from 'fs';
import path from 'path';
import type { Booking } from '../shared/types';

export default class Store {
  private bookings: Booking[];

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.bookings = JSON.parse(fs.readFileSync(file, 'utf8')) as Booking[];
    } catch {
      this.bookings = [];
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.bookings, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace so a crash never leaves a half-written file
  }

  all(): Booking[] {
    return this.bookings;
  }

  get(id: string): Booking | undefined {
    return this.bookings.find((b) => b.id === id);
  }

  insert(booking: Booking): Booking {
    this.bookings.push(booking);
    this.save();
    return booking;
  }

  remove(id: string): boolean {
    const i = this.bookings.findIndex((b) => b.id === id);
    if (i === -1) return false;
    this.bookings.splice(i, 1);
    this.save();
    return true;
  }

  update(id: string, patch: Partial<Booking>): Booking | null {
    const b = this.get(id);
    if (!b) return null;
    Object.assign(b, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return b;
  }
}
