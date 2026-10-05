import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

@Component({ selector: 'fixture-counter', template: '<button (click)="count = count + 1">{{count}}</button>' })
class CounterComponent { count = 0; }

const mode = (window as any).__karma__.config.args[0];
describe('real Angular component', () => {
  beforeEach(() => TestBed.configureTestingModule({ declarations: [CounterComponent] }));
  afterEach(() => TestBed.resetTestingModule());

  it('renders through Angular TestBed', () => {
    const fixture = TestBed.createComponent(CounterComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').textContent).toBe('0');
  });

  if (mode === 'outcomes') {
    it('handles a browser click and updates the binding', () => {
      const fixture = TestBed.createComponent(CounterComponent);
      fixture.detectChanges();
      fixture.nativeElement.querySelector('button').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('button').textContent).toBe('1');
    });
    it('reports an intentional failure', () => expect(1).toBe(2));
    xit('reports a skipped test', () => fail('must not run'));
  }
  if (mode === 'slow') {
    // Karma can buffer 50 results on polling. Fill that real transport batch
    // before the pending spec; a one-result fixture can finish before reporting.
    for (let index = 1; index < 50; index++) {
      it('renders transport batch case ' + index, () => {
        const fixture = TestBed.createComponent(CounterComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button').textContent).toBe('0');
      });
    }
    it('waits for collector cancellation', (_done: DoneFn) => {
      // Deliberately unresolved: cancellation must happen before suite completion.
      // Jasmine's existing timeout still makes a broken cancellation gate fail.
    });
  }
});
