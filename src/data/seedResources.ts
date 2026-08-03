// ============================================================
// Seed: trusted resources (RESOURCES-FORMAT.md's Knowledge/Wisdom split).
// These are the SAME sources already cited in the project's own
// Discovery Report (References section) — this is not new research,
// it's finally wiring already-identified trusted sources into the
// generation pipeline itself, per the /teach rule: "never trust your
// parametric knowledge" for exam-specific facts.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Resource } from '../types';

export const TRUSTED_RESOURCES: Omit<Resource, 'id'>[] = [
  {
    title: 'الهيئة العامة للتقويم والتعليم والتدريب (ETEC) — نظرة عامة على اختبار القدرات',
    url: 'https://etec.gov.sa/ar/centers/qiyas/p/p-7d1870ff-a881-4e9a-9f9d-8f2a2c4df032',
    kind: 'knowledge',
    annotation:
      'المصدر الرسمي الوحيد الموثوق لبنية الاختبار وأسماء الأقسام والتوقيت ونظام التقييم. ' +
      'يُستخدم هذا المصدر حصريًا لأي معلومة عن تفاصيل الاختبار (عدد الأسئلة، المدة، سلم الدرجات، عدد مرات التقديم). ' +
      'عند أي تعارض بين هذا المصدر وأي مصدر آخر، تُعتمد معلومات ETEC دائمًا.',
    verified_at: '2026-07-01',
    is_official_etec: true,
  },
  {
    title: 'بوابة خدمات قياس الإلكترونية (التسجيل والمواعيد)',
    url: 'https://e-services.etec.gov.sa',
    kind: 'knowledge',
    annotation: 'تُستخدم لكل ما يخص مواعيد التسجيل والجدولة وسياسة إعادة التقديم — لا تُستخدم كمصدر لمحتوى الأسئلة.',
    verified_at: '2026-07-01',
    is_official_etec: true,
  },
  {
    title: 'مدارس نجد الأهلية — نظرة على بنية الاختبار وتوقيته (مصدر ثانوي، تمت مطابقته مع ETEC)',
    url: 'https://nns.edu.sa',
    kind: 'knowledge',
    annotation:
      'مصدر ثانوي للتأكيد على أرقام التوقيت (تقسيم زمن الأقسام) فقط — لا يُعتمد وحده أبدًا، ' +
      'ويُرجَّح مصدر ETEC الرسمي دائمًا عند أي تعارض.',
    verified_at: '2026-07-01',
    is_official_etec: false,
  },
  {
    title: 'مُبهر — نظرة على الاختبار التجريبي المحوسب للقدرات (مصدر ثانوي)',
    url: 'https://blog.mubhir.sa',
    kind: 'wisdom',
    annotation:
      'منظور مجتمعي/تحضيري حول شعور تجربة الاختبار المحوسب — مفيد للنبرة وصياغة المحتوى الموجّه للطالب، ' +
      'وليس مصدرًا موثوقًا للحقائق الرسمية عن الاختبار الحقيقي.',
    verified_at: '2026-07-01',
    is_official_etec: false,
  },
];

export function seedTrustedResources(store: InMemoryStore): void {
  for (const r of TRUSTED_RESOURCES) {
    // avoid duplicate inserts if this is called more than once in a process
    if (store.resources.some((existing) => existing.title === r.title)) continue;
    store.resources.push({ ...r, id: crypto.randomUUID() });
  }
}
