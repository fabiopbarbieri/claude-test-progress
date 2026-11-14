// @ts-nocheck
// Angular and Jasmine types come from this fixture's own install (scripts/check-karma.py); `claude plugin
// validate` type-checks every file under tests/ without them, so it would only report missing modules.
import 'zone.js/dist/zone';
import 'zone.js/dist/zone-testing';
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
import './progress.spec';
