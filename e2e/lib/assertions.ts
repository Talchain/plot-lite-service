export class Assert {
  private items: any[] = [];
  ok(name: string, cond: boolean, exp: any = 'true', act: any = cond) {
    this.items.push({name, passed: cond, expected: exp, actual: act});
  }
  eq(name: string, act: any, exp: any) { this.ok(name, act === exp, exp, act); }
  get all() { return this.items; }
  get pass() { return this.items.every(i => i.passed); }
  summary() {
    const passed = this.items.filter(i => i.passed).length;
    return {passed, failed: this.items.length - passed, total: this.items.length};
  }
}
