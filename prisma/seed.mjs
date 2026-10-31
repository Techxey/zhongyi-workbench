import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const now = () => new Date().toISOString();

const SYMPTOM_TERMS = [
  "入睡困难", "多梦", "易醒", "心悸", "口干", "口苦", "乏力", "纳差",
  "腹胀", "便溏", "便秘", "尿频", "畏寒", "手足心热", "自汗", "盗汗",
  "头晕", "头痛", "耳鸣", "咳嗽", "咽干", "咽痛", "痰多", "胸闷",
  "气短", "腰膝酸软", "月经不调", "痛经", "经量少", "性急易怒", "情绪低落", "食欲亢进",
];

// 十八反（按「诸参辛芍叛藜芦」等歌诀拆到具体药对）
const EIGHTEEN_ANTAGONISMS = [
  ["甘草", "甘遂"], ["甘草", "大戟"], ["甘草", "海藻"], ["甘草", "芫花"],
  ["乌头", "贝母"], ["乌头", "瓜蒌"], ["乌头", "半夏"], ["乌头", "白蔹"], ["乌头", "白及"],
  ["藜芦", "人参"], ["藜芦", "沙参"], ["藜芦", "丹参"], ["藜芦", "玄参"], ["藜芦", "细辛"], ["藜芦", "芍药"],
];

// 十九畏
const NINETEEN_FEARS = [
  ["硫黄", "朴硝"], ["水银", "砒霜"], ["狼毒", "密陀僧"], ["巴豆", "牵牛子"],
  ["丁香", "郁金"], ["川乌", "犀角"], ["草乌", "犀角"], ["牙硝", "三棱"],
  ["官桂", "赤石脂"], ["人参", "五灵脂"],
];

async function main() {
  // 1. 种子账号
  const passwordHash = await bcrypt.hash("doctor1234", 10);
  await prisma.user.upsert({
    where: { username: "doctor" },
    update: {},
    create: {
      username: "doctor",
      passwordHash,
      displayName: "李医生",
      role: "doctor",
      createdAt: now(),
    },
  });

  // 2. 默认设置
  for (const [key, value] of [
    ["backup_retention_days", "30"],
    ["schema_version", "r2"],
    ["clinic_name", "杏林堂中医诊所"],
  ]) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value, updatedAt: now() },
    });
  }

  // 3. 问诊要点词表（标签按使用频次排序）
  // 初始频次按列表顺序递减：空库时前 12 个就是最常见的症状，
  // 之后医生每点一次就 useCount+1，真实使用会逐渐覆盖初始顺序。
  for (const [index, term] of SYMPTOM_TERMS.entries()) {
    const seedCount = SYMPTOM_TERMS.length - index;
    await prisma.symptomTerm.upsert({
      where: { normTerm: term },
      update: { useCount: seedCount },
      create: { term, normTerm: term, useCount: seedCount, createdAt: now() },
    });
  }

  // 4. 配伍禁忌（只提示，不拦截处方）
  const existing = await prisma.herbIncompatibility.count();
  if (existing === 0) {
    await prisma.herbIncompatibility.createMany({
      data: [
        ...EIGHTEEN_ANTAGONISMS.map(([a, b]) => ({ herbA: a, herbB: b, rule: "十八反" })),
        ...NINETEEN_FEARS.map(([a, b]) => ({ herbA: a, herbB: b, rule: "十九畏" })),
      ],
    });
  }

  // 5. 证型别名（接诊台「证型候选」的来源：主诉/现病史命中的关键词排前面）
  const SYNDROME_ALIASES = {
    心脾两虚: ["失眠", "多梦", "心悸", "健忘", "纳差", "乏力"],
    肝郁脾虚: ["情绪低落", "胁胀", "善太息", "腹胀", "便溏", "易怒"],
    肝肾阴虚: ["腰膝酸软", "手足心热", "盗汗", "耳鸣", "口干", "头晕"],
    脾虚湿盛: ["腹胀", "便溏", "纳差", "身重", "苔白腻", "头重"],
    气血两虚: ["乏力", "气短", "面白", "心悸", "头晕", "自汗"],
    痰湿内阻: ["痰多", "胸闷", "眩晕", "呕恶", "苔白腻", "身重"],
    肝阳上亢: ["头痛", "眩晕", "易怒", "耳鸣", "面红", "口苦"],
    风寒束表: ["恶寒", "发热", "鼻塞", "清涕", "头痛", "身痛"],
    风热犯肺: ["咽痛", "咳嗽", "发热", "口渴", "黄痰", "鼻塞"],
    脾胃虚寒: ["腹痛", "畏寒", "便溏", "纳差", "喜温", "乏力"],
    肾阳不足: ["畏寒", "腰膝酸软", "尿频", "水肿", "乏力", "便溏"],
    瘀血阻滞: ["刺痛", "痛处固定", "舌紫暗", "脉涩", "月经不调", "痛经"],
    肝胃不和: ["胃脘胀", "嗳气", "胁胀", "恶心", "易怒", "纳差"],
    阴虚火旺: ["手足心热", "盗汗", "口干", "口苦", "舌红", "脉数"],
  };
  for (const [syndrome, keywords] of Object.entries(SYNDROME_ALIASES)) {
    for (const keyword of keywords) {
      const exists = await prisma.kbAlias.findFirst({
        where: { aliasType: "syndrome", normTerm: syndrome, term: keyword },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.kbAlias.create({
        data: { term: keyword, normTerm: syndrome, aliasType: "syndrome", weight: 1 },
      });
    }
  }

  // 6. starter 方剂：全部为公版古籍方，只放常见组成与功效，供 R2 方解摘录与 R3 检索先用
  const STARTER_FORMULAS = [
    {
      name: "归脾汤",
      source: "《正体类要》",
      efficacy: "益气补血，健脾养心",
      indication: "心脾两虚证：心悸失眠，体倦食少，面色萎黄",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary:
        "黄芪、党参、白术、炙甘草补脾益气；当归、龙眼肉养血；茯神、远志、酸枣仁宁心安神；木香理气醒脾，使补而不滞；姜枣调和脾胃。",
      aliases: ["归脾"],
      composition: [
        ["黄芪", "30g"], ["党参", "15g"], ["白术", "15g"], ["茯神", "15g"],
        ["当归", "12g"], ["远志", "6g"], ["酸枣仁", "20g"], ["龙眼肉", "12g"],
        ["木香", "6g"], ["炙甘草", "6g"],
      ],
    },
    {
      name: "酸枣仁汤",
      source: "《金匮要略》",
      efficacy: "养血安神，清热除烦",
      indication: "虚劳虚烦不得眠，心悸盗汗，头目眩晕",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary:
        "酸枣仁养血补肝、宁心安神为君；茯苓宁心、知母滋阴清热除烦；川芎调畅气血；甘草和中缓急。",
      aliases: ["酸枣仁"],
      composition: [["酸枣仁", "15g"], ["甘草", "3g"], ["知母", "6g"], ["茯苓", "6g"], ["川芎", "6g"]],
    },
    {
      name: "逍遥散",
      source: "《太平惠民和剂局方》",
      efficacy: "疏肝解郁，养血健脾",
      indication: "肝郁血虚脾弱证：两胁作痛，头痛目眩，神疲食少，月经不调",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary:
        "柴胡疏肝解郁；当归、白芍养血柔肝；白术、茯苓、甘草健脾益气；薄荷、生姜助柴胡疏肝散热。",
      aliases: ["逍遥"],
      composition: [
        ["柴胡", "9g"], ["当归", "9g"], ["白芍", "9g"], ["白术", "9g"],
        ["茯苓", "9g"], ["炙甘草", "4.5g"], ["薄荷", "3g"],
      ],
    },
    {
      name: "六味地黄丸",
      source: "《小儿药证直诀》",
      efficacy: "滋阴补肾",
      indication: "肾阴不足证：腰膝酸软，头晕耳鸣，手足心热，盗汗",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary:
        "熟地黄滋阴补肾、填精益髓为君；山茱萸养肝涩精，山药补脾固肾；泽泻泻肾浊，牡丹皮清虚热，茯苓渗脾湿，三泻使补而不腻。",
      aliases: ["六味地黄", "六味"],
      composition: [
        ["熟地黄", "24g"], ["山茱萸", "12g"], ["山药", "12g"],
        ["泽泻", "9g"], ["牡丹皮", "9g"], ["茯苓", "9g"],
      ],
    },
    {
      name: "补中益气汤",
      source: "《内外伤辨惑论》",
      efficacy: "补中益气，升阳举陷",
      indication: "脾胃气虚、中气下陷证：体倦乏力，食少便溏，气短懒言",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary:
        "黄芪补中益气、升阳固表为君；人参、白术、炙甘草健脾益气；当归养血；陈皮理气和胃；升麻、柴胡升举清阳。",
      aliases: ["补中益气"],
      composition: [
        ["黄芪", "18g"], ["炙甘草", "9g"], ["人参", "6g"], ["当归", "3g"],
        ["陈皮", "6g"], ["升麻", "6g"], ["柴胡", "6g"], ["白术", "9g"],
      ],
    },
    {
      name: "甘麦大枣汤",
      source: "《金匮要略》",
      efficacy: "养心安神，和中缓急",
      indication: "脏躁：精神恍惚，悲伤欲哭，心中烦乱，睡眠不安",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary: "小麦养心安神、除烦止渴；甘草缓急和中；大枣补脾益气、润脏缓急，三味甘润平补。",
      aliases: ["甘麦大枣"],
      composition: [["甘草", "9g"], ["小麦", "30g"], ["大枣", "10枚"]],
    },
    {
      name: "四君子汤",
      source: "《太平惠民和剂局方》",
      efficacy: "益气健脾",
      indication: "脾胃气虚证：面色萎白，语声低微，食少便溏，四肢乏力",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary: "人参大补元气为君；白术健脾燥湿；茯苓渗湿健脾；炙甘草益气和中，四味平补脾胃。",
      aliases: ["四君子"],
      composition: [["人参", "9g"], ["白术", "9g"], ["茯苓", "9g"], ["炙甘草", "6g"]],
    },
    {
      name: "二陈汤",
      source: "《太平惠民和剂局方》",
      efficacy: "燥湿化痰，理气和中",
      indication: "湿痰证：咳嗽痰多色白易咯，胸膈痞闷，恶心呕吐",
      usageText: "每日 1 剂，水煎 400ml，分早晚温服",
      commentary: "半夏燥湿化痰、降逆和胃为君；橘红理气燥湿；茯苓健脾渗湿；甘草调和诸药。",
      aliases: ["二陈"],
      composition: [["半夏", "15g"], ["橘红", "15g"], ["茯苓", "9g"], ["炙甘草", "4.5g"]],
    },
  ];

  for (const formula of STARTER_FORMULAS) {
    const item = await prisma.kbItem.upsert({
      where: { type_name_source: { type: "formula", name: formula.name, source: formula.source } },
      update: {},
      create: {
        type: "formula",
        name: formula.name,
        source: formula.source,
        currentVersion: 1,
        status: "active",
        createdAt: now(),
        updatedAt: now(),
      },
    });

    const versionExists = await prisma.kbItemVersion.findFirst({
      where: { kbItemId: item.id, version: 1 },
      select: { id: true },
    });
    if (!versionExists) {
      await prisma.kbItemVersion.create({
        data: {
          kbItemId: item.id,
          version: 1,
          compositionJson: JSON.stringify(
            formula.composition.map(([name, dose]) => ({ name, dose })),
          ),
          efficacy: formula.efficacy,
          indication: formula.indication,
          usageText: formula.usageText,
          commentary: formula.commentary,
          createdAt: now(),
        },
      });
    }

    for (const alias of formula.aliases) {
      const aliasExists = await prisma.kbAlias.findFirst({
        where: { aliasType: "formula_name", kbItemId: item.id, term: alias },
        select: { id: true },
      });
      if (aliasExists) continue;
      await prisma.kbAlias.create({
        data: {
          kbItemId: item.id,
          term: alias,
          normTerm: formula.name,
          aliasType: "formula_name",
          weight: 1,
        },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    settings: await prisma.setting.count(),
    symptomTerms: await prisma.symptomTerm.count(),
    incompatibilities: await prisma.herbIncompatibility.count(),
    kbItems: await prisma.kbItem.count(),
    kbAliases: await prisma.kbAlias.count(),
  };
  console.log("seed done:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
