# StudySheet · 学习记录

记录每天「大科目 → 事项」的学习时长，暂停时选原因，结束后自动扣除暂停时间，
之后按周分析、帮助提升学习效率。

## 使用场景

共用一台设备（家里平板 / 一台手机），多人轮流记录。**不需要账号登录**，
点一下人名即切换身份；人名只是分组标签，不是权限边界 —— 任何拿到这台设备的人
都能看到全部记录。

数据全部存在本机浏览器 IndexedDB 里，不上传服务器。

## 技术栈

| 层 | 选型 | 原因 |
| --- | --- | --- |
| 构建 | Vite + React 19 + TypeScript | 手机浏览器直接访问，改动即时生效 |
| 样式 | Tailwind v4 | 移动端表单密集， utility 写起来快 |
| 存储 | Dexie（IndexedDB） | 本地优先、离线可用，不需要后端即可跑通 |
| 状态 | zustand | 计时器状态跨组件共享 |
| 时间 | dayjs | 起止时间与格式化 |

数据层集中在 `src/db/repo.ts`：UI 不直接调 Dexie。将来要支持**各自手机、数据汇总**
（多端同步）时，只把这一层换成后端 API（建议 Next.js + Prisma + PostgreSQL，或直接用
Supabase 省掉鉴权和部署），其余代码不动。

## 核心数据模型

```
Profile       人名，共用设备上的分组标签
Subject       大科目（语文…）
TaskType      事项（默写 / 预习…），subjectId 为 null 表示通用事项
PauseReason   暂停原因，自定义项也存进字典并按使用次数排序
StudySession  一次记录，结束时冻结 netMs / gapsMs / breaksCount
SessionSegment work / break 事件流
```

`SessionSegment` 存成事件流而不是一个 `pauseMs` 字段，是为了周报能回答
「走神平均发生在开始后第几分钟」「哪类事项暂停最多」。净时长 = Σ work 段。

## 两个实现约束

**计时不靠 setInterval 累加。** 只存时间戳，每次渲染用 `Date.now()` 反算，
所以切后台、锁屏再回来都不会丢时间。见 `src/hooks/useNow.ts`。

**日期按本地时区取。** `toISOString()` 是 UTC，UTC+8 的用户在 10-19 00:30 学习会
被错标成 10-18。见 `src/lib/time.ts` 的 `dayKey`。

## 阶段

- [x] **M1** 人员切换、科目/事项字典、计时器（开始 / 暂停选原因 / 继续 / 结束备注）、
      补录、今日列表
- [ ] **M2** 日视图、周视图；按科目与按事项的时长曲线、暂停原因统计；全部 / 单人 / 对比
- [ ] **M3** 周报：规则层指标（总时长环比、各科占比、暂停密度、计划达成率、连续天数、
      最长专注段）+ 叙述层建议
- [ ] **M4** 导出 CSV / JSON
- [ ] **M5** 拍照 OCR：识别作业清单生成待办，OCR 结果一律先进「草稿 + 确认」再入库
- [ ] **M6** 多端同步（此时才引入后端与邀请码，替代裸人名）

## 本地运行

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```
