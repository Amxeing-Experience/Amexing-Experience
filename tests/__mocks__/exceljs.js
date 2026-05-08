/**
 * Manual mock for ExcelJS to handle ESM import issues in tests
 * Created by Denisse Maldonado
 */

class Workbook {
  constructor() {
    this.creator = '';
    this.lastModifiedBy = '';
    this.created = new Date();
    this.modified = new Date();
    this.worksheets = [];
  }

  addWorksheet(name) {
    const worksheet = new Worksheet(name);
    this.worksheets.push(worksheet);
    return worksheet;
  }

  xlsx = {
    writeBuffer: jest.fn().mockResolvedValue(Buffer.from('mock excel data')),
    write: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined)
  };
}

class Worksheet {
  constructor(name) {
    this.name = name;
    this.columns = [];
    this.rows = [];
    this._rows = [];
  }

  addRow(data) {
    const row = new Row(data);
    this.rows.push(row);
    this._rows.push(row);
    return row;
  }

  getRow(index) {
    if (!this._rows[index - 1]) {
      this._rows[index - 1] = new Row();
    }
    return this._rows[index - 1];
  }

  mergeCells() {
    // Mock implementation
  }

  getCell(address) {
    return new Cell();
  }
}

class Row {
  constructor(data) {
    this.values = data || [];
    this.font = {};
    this.fill = {};
    this.alignment = {};
    this.border = {};
  }

  getCell(index) {
    return new Cell();
  }
}

class Cell {
  constructor() {
    this.value = '';
    this.font = {};
    this.fill = {};
    this.alignment = {};
    this.border = {};
    this.numFmt = '';
  }
}

module.exports = {
  Workbook,
  stream: {
    xlsx: {
      WorkbookWriter: Workbook
    }
  }
};