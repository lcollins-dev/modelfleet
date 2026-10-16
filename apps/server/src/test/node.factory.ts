import { Node } from '@/core/node/entities/node.entity';

export const TEST_NODE_ID = 42;
export const TEST_NODE_KEY = '11111111-1111-4111-8111-111111111111';

/** Builds a node as a row read back from the database, generated columns included. */
export const buildNode = (overrides: Partial<Node> = {}): Node => {
  const node = new Node({ nodeKey: TEST_NODE_KEY, name: 'rig-01', secretHash: 'hashed-secret' });

  node.id = TEST_NODE_ID;
  node.createdDate = new Date('2026-05-01T09:00:00Z');

  Object.assign(node, overrides);

  return node;
};
