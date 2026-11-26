// Tiny JSON-file store. Plenty for a side business with a handful of bookings a week.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.bookings = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.bookings = [];
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.bookings, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace so a crash never leaves a half-written file
  }

  all() {
    return this.bookings;
  }

  get(id) {
    return this.bookings.find((b) => b.id === id);
  }

  insert(booking) {
    this.bookings.push(booking);
    this.save();
    return booking;
  }

  update(id, patch) {
    const b = this.get(id);
    if (!b) return null;
    Object.assign(b, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return b;
  }
}

module.exports = Store;
