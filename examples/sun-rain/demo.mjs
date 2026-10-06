import { parseOptions } from '../../src/config.mjs';
import { initializeStore, registerTask, updateTask, addDecision, addEvidence, readProjectOverview } from '../../src/store.mjs';
const { dbPath, inputPath } = parseOptions();
if (inputPath) throw new Error('DEMO_TAKES_NO_INPUT');
const db = initializeStore(dbPath);
try {
  registerTask(db, { task_id: 'TRIP-001', dedupe_key: 'rainy-day-alternative', title: '晴雨行程：雨天备选页面', owner: 'demo-worker', checkpoint: '尚未开始', next_action: '准备虚构的雨天备选方案' });
  updateTask(db, { task_id: 'TRIP-001', actor: 'demo-worker', expected_revision: 1, operation_id: 'demo-checkpoint-1', status: 'in_progress', checkpoint: '已完成虚构页面草图', next_action: '检查键盘导航；场馆开放时间未提供' });
  addDecision(db, { decision_id: 'DEC-001', task_id: 'TRIP-001', actor: 'demo-worker', expected_revision: 2, operation_id: 'demo-decision-1', summary: '雨天优先展示室内备选', rationale: '教学演示中的虚构产品决定，不代表真实审批' });
  addEvidence(db, { evidence_id: 'EVD-001', task_id: 'TRIP-001', actor: 'demo-worker', expected_revision: 3, operation_id: 'demo-evidence-1', summary: '合成草图说明；未做真实用户测试', reference: 'examples/sun-rain/sketch.txt' });
  process.stdout.write(JSON.stringify(readProjectOverview(db, {}), null, 2) + '\n');
} finally { db.close(); }
