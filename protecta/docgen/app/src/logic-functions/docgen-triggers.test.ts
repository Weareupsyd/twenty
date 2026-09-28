import { describe, expect, it, vi } from 'vitest';
vi.mock('src/lib/records', () => ({
  CoreDbClient: class {},
  MemoryDbClient: class {},
}));
import fillOnDocumentCreated from 'src/logic-functions/fill-on-document-created.logic-function';
import generateOnPolicyCreated from 'src/logic-functions/generate-on-policy-created.logic-function';
import generateDocumentRoute from 'src/logic-functions/generate-document-route.logic-function';
import documentView from 'src/logic-functions/document-view.logic-function';
import documentDocx from 'src/logic-functions/document-docx.logic-function';

const configOf = (logicFunction: unknown) =>
  (
    logicFunction as {
      config: {
        name: string;
        databaseEventTriggerSettings?: { eventName: string };
        httpRouteTriggerSettings?: { path: string; httpMethod: string };
      };
    }
  ).config;

describe('document generator triggers and routes', () => {
  it('generates documents on Protecta policy creation', () => {
    const config = configOf(generateOnPolicyCreated);
    expect(config.name).toBe('generate-on-policy-created');
    expect(config.databaseEventTriggerSettings).toEqual({
      eventName: 'insurancePolicy.created',
    });
  });

  it('fills manually created document records', () => {
    const config = configOf(fillOnDocumentCreated);
    expect(config.name).toBe('fill-on-document-created');
    expect(config.databaseEventTriggerSettings).toEqual({
      eventName: 'generatedDocument.created',
    });
  });

  it('exposes the generate and download routes', () => {
    expect(configOf(generateDocumentRoute).httpRouteTriggerSettings).toEqual({
      path: '/docgen/generate',
      httpMethod: 'POST',
      isAuthRequired: false,
    });
    expect(configOf(documentView).httpRouteTriggerSettings).toEqual({
      path: '/docgen/documents/view',
      httpMethod: 'GET',
      isAuthRequired: false,
    });
    expect(configOf(documentDocx).httpRouteTriggerSettings).toEqual({
      path: '/docgen/documents/docx',
      httpMethod: 'GET',
      isAuthRequired: false,
    });
  });
});
