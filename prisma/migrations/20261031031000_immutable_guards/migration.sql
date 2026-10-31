-- 病历不可变：visit_revisions 只允许 INSERT（数据库层兜底，配合服务层校验）
CREATE TRIGGER IF NOT EXISTS visit_revisions_no_update
BEFORE UPDATE ON visit_revisions
BEGIN
  SELECT RAISE(ABORT, 'visit_revisions 是不可变表：请新增一条 revision，不要修改历史病历');
END;

CREATE TRIGGER IF NOT EXISTS visit_revisions_no_delete
BEFORE DELETE ON visit_revisions
BEGIN
  SELECT RAISE(ABORT, 'visit_revisions 是不可变表：不允许删除历史 revision');
END;

-- 审计日志只增不改
CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs 是只增表：不允许修改审计记录');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs 是只增表：不允许删除审计记录');
END;

-- 知识库版本同样只增不改（修订＝新增 version）
CREATE TRIGGER IF NOT EXISTS kb_item_versions_no_update
BEFORE UPDATE ON kb_item_versions
BEGIN
  SELECT RAISE(ABORT, 'kb_item_versions 是只增表：修订请新增一个 version');
END;

-- 常用索引：患者列表按姓名搜索、就诊时间轴倒序
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_visits_patient_at ON visits(patient_id, visit_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
