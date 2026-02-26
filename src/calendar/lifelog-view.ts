import { EventInput } from '@fullcalendar/core';
import { getBlockAttrs, sql, getBlockKramdown, setBlockAttrs } from '../api/api';
import { ATTRS } from '../lifelog/module-lifelog';
import { showMessage } from "siyuan";

export class LifelogView {
    private static lastProcessTime: number = 0;
    // 添加以下两行记录上次的start和end日期
    private static lastStartDate?: Date;
    private static lastEndDate?: Date;

    // 改进：按天存储缓存，键为日期字符串（YYYY/MM/DD）
    private static dayEventsCache: Map<string, { events: EventInput[], timestamp: number }> = new Map();
    private static readonly CACHE_TTL_MS = 60 * 1000 * 5;

    // 数据变更标志位：当模块检测到 Lifelog 数据更新时置位
    private static dirty: boolean = false;

    // 主动清理缓存（供外部调用：有数据变更时立即失效）
    static clearCache(): void {
        this.dayEventsCache.clear();
    }

    // 添加自动清理过期缓存的方法
    private static cleanupExpiredCache(): void {
        const now = Date.now();
        for (const [dateKey, cached] of this.dayEventsCache.entries()) {
            if (now - cached.timestamp > this.CACHE_TTL_MS) {
                this.dayEventsCache.delete(dateKey);
            }
        }
    }

    // 标记数据已更新（置位并清理缓存）
    static markDirty(): void {
        this.dirty = true;
    }

    // 查询数据是否处于“已更新”状态
    static isDirty(): boolean {
        return this.dirty;
    }

    // 清除“已更新”状态（在重新获取最新数据后调用）
    static clearDirty(): void {
        this.dirty = false;
    }
    /**
     * 处理块的属性
     * @param blockId 块ID
     * @param dateStr 日期字符串（YYYY/MM/DD格式）
     * @returns 处理后的相关属性
     */
    private static async processBlockAttributes(blockId: string, dateStr: string, options: { compareAndUpdate?: boolean } = {}): Promise<{ relevantAttrs: Record<string, string>, references: any[] }> {
        // 从 kramdown 中解析内容、属性和引用
        const blockKramdown = await getBlockKramdown(blockId);
        const kramdown = blockKramdown.kramdown;
        const relevantAttrs: Record<string, string> = {};
        const targetAttrs = [ATTRS.date, ATTRS.time, ATTRS.type, ATTRS.content];
        const now = new Date().toISOString();
        const needsUpdate: Record<string, string> = {};
        let hasChanges = false;

        // 解析 kramdown 中custom-liflog的属性
        const attrMatch = kramdown.match(/\{:[^}]*\}/g);
        const attrs: Record<string, string> = {};
        if (attrMatch) {
            const customAttrs = attrMatch[0].match(/custom-lifelog-(\w+)="([^"]+)"/g);
            if (customAttrs) {
                customAttrs.forEach(attr => {
                    const [_, key, value] = attr.match(/custom-lifelog-(\w+)="([^"]+)"/) || [];
                    if (key) {
                        attrs[`custom-lifelog-${key}`] = value;
                    }
                });
            }
        }

        // 解析内容部分和引用
        let processedContent = attrs[ATTRS.content] || '';
        const contentMatch = kramdown.match(/(\d{2}:\d{2})\s+([^：]+)：(.+?)(?=\s+\{:|$)/);
        let content = contentMatch ? contentMatch[3] : '';
        const refRegex = /(.*?)\(\(([^\s]+)\s+['"](.*?)['"]\)\)/g;
        if (options.compareAndUpdate) {
            processedContent = '';
            let lastIndex = 0;
            for (const match of content.matchAll(refRegex)) {
                processedContent += content.slice(lastIndex, match.index) + match[1].trim() + match[3].trim();
                lastIndex = match.index + match[0].length;
            }
            processedContent += content.slice(lastIndex);
        }
        const references = [...content.matchAll(refRegex)].map(match => ({
            id: match[2].trim(),
            content: `${match[1].trim()}${match[3].trim()}`,
            type: 'ref'
        })).filter(ref => ref.id);

        const parsedValues = {
            time: contentMatch ? contentMatch[1] : '',
            type: contentMatch ? contentMatch[2].trim() : '',
            content: processedContent.trim(),
            references
        };

        // 检查并更新每个目标属性
        targetAttrs.forEach((attrKey) => {
            // 根据属性类型获取新值
            // 使用完整的属性名称
            const newValue = (
                attrKey === ATTRS.date ? (dateStr || '') :
                attrKey === ATTRS.time ? (parsedValues.time || '') :
                attrKey === ATTRS.type ? (parsedValues.type || '') :
                attrKey === ATTRS.content ? (parsedValues.content || '') : ''
            );

            // 检查属性是否需要更新
            if (options.compareAndUpdate && (newValue !== '') && attrs[attrKey] !== newValue) {
                hasChanges = true;
                needsUpdate[attrKey] = newValue;
                console.warn(`属性 ${attrKey} 需要更新，从 ${attrs[attrKey]} 更新为 ${newValue}`);
            } else {
                relevantAttrs[attrKey] = attrs[attrKey];
            }
        });

        // 如果有属性需要更新，执行更新操作
        if (hasChanges) {
            needsUpdate[ATTRS.updated] = now;
            await setBlockAttrs(blockId, needsUpdate);
            Object.assign(relevantAttrs, needsUpdate);
            console.log(`修正块 ${blockId} 的属性:`, needsUpdate);
            showMessage(`已更新lifelog块 ${processedContent.trim()} 的属性,详见console.`, 3000, 'info');
        }

        return { relevantAttrs, references };
    }
    static async getLifelogEvents(start?: Date, end?: Date): Promise<EventInput[]> {
        try {
            if (!start || !end) {
                return [];
            }

            // 添加 daydiff 检查，如果大于 32 天则不输出 lifelog 月视图和年视图不显示Lifelog
            const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff > 32) {
                console.log(`日期范围超过32天（${daysDiff}天），不输出 lifelog 事件`);
                return [];
            }

            const events: EventInput[] = [];
            const currentDate = new Date(start);
            // 上一日的最后一个事件结束时间与是否有数据标记
            let lastDayLastEventEndTime: string | null = null;
            let hasPrevDayData = false;

            const now = Date.now();
            const timeDiff = now - LifelogView.lastProcessTime;

            // 检测start或end是否有变化
            const isStartChanged = LifelogView.lastStartDate ? LifelogView.lastStartDate.getTime() !== start.getTime() : true;
            const isEndChanged = LifelogView.lastEndDate ? LifelogView.lastEndDate.getTime() !== end.getTime() : true;
            const hasDateRangeChanged = isStartChanged || isEndChanged;

            // 修改shouldUpdate条件，当日期范围变化时忽略30秒限制
            const shouldUpdate = (daysDiff === 1 &&  (timeDiff >= 30*1000 || hasDateRangeChanged));

            // 更新上次的start和end日期
            LifelogView.lastStartDate = new Date(start);
            LifelogView.lastEndDate = new Date(end);

            // 处理块的属性，默认不进行属性对比修改
            if (shouldUpdate) {
                LifelogView.lastProcessTime = now;
            }

            // 循环遍历从开始日期到结束日期的每一天
            while (currentDate <= end) {
                const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '/');

                // 检查当天是否已有缓存
                const cachedDayEvents = this.dayEventsCache.get(dateStr);
                if (cachedDayEvents && (now - cachedDayEvents.timestamp) < this.CACHE_TTL_MS && !this.isDirty() && !shouldUpdate) {
                    // 如果当天有缓存且未过期，直接使用缓存的事件
                    events.push(...cachedDayEvents.events);
                } else {
                    // 构建当天的 SQL 查询语句
                    const blockIdsQuery = `
                        SELECT DISTINCT block_id
                        FROM attributes
                        WHERE name = '${ATTRS.date}' AND value = '${dateStr}'
                    `;

                    const blockIdsResult = await sql(blockIdsQuery);
                    const blockIds = blockIdsResult.map((item: any) => item.block_id);

                    if (blockIds.length === 0) {
                        // 前一天无数据，则不进行跨天衔接
                        hasPrevDayData = false;
                        lastDayLastEventEndTime = null;
                        // 推进到下一天
                        currentDate.setDate(currentDate.getDate() + 1);
                        continue;
                    }

                    const groupedData = new Map<string, any>();
                    for (const blockId of blockIds) {
                        const { relevantAttrs, references } = await LifelogView.processBlockAttributes(blockId, dateStr, { compareAndUpdate: shouldUpdate });
                        groupedData.set(blockId, { ...relevantAttrs, references });
                    }

                    const items = Array.from(groupedData.entries())
                       .filter(([_, data]) => data[ATTRS.time] && data[ATTRS.date])
                       .sort((a, b) => a[1][ATTRS.time].localeCompare(b[1][ATTRS.time]));

                    // 创建当天事件的临时数组用于缓存
                    const dayEvents = [];

                    for (let i = 0; i < items.length; i++) {
                        const [blockId, data] = items[i];
                        const endTime = data[ATTRS.time];
                        let eventStartTime, eventStartDate;

                        if (i === 0) {
                            if (hasPrevDayData && lastDayLastEventEndTime) {
                                eventStartTime = lastDayLastEventEndTime;
                                // 使用前一天的日期
                                const prevDate = new Date(currentDate);
                                prevDate.setDate(prevDate.getDate() - 1);
                                eventStartDate = prevDate.toISOString().split('T')[0].replace(/-/g, '/');
                            } else {
                                // 无上一日数据，默认从当天 00:00 开始
                                eventStartTime = '00:00';
                                eventStartDate = dateStr;
                            }
                        } else {
                            eventStartTime = items[i - 1][1][ATTRS.time];
                            eventStartDate = dateStr;
                        }

                        const formattedStartDate = eventStartDate.replace(/\//g, '-');
                        const formattedEndDate = dateStr.replace(/\//g, '-');

                        const [startYear, startMonth, startDay] = formattedStartDate.split('-').map(Number);
                        const [endYear, endMonth, endDay] = formattedEndDate.split('-').map(Number);
                        const [startHour, startMinute] = eventStartTime.split(':').map(Number);
                        const [endHour, endMinute] = endTime.split(':').map(Number);

                        // 使用已解析的引用数据

                        const eventData = {
                            id: blockId,
                            title: `${data[ATTRS.type]}: ${data[ATTRS.content]}`,
                            start: new Date(startYear, startMonth - 1, startDay, startHour, startMinute),
                            end: new Date(endYear, endMonth - 1, endDay, endHour, endMinute),
                            allDay: false,
                            extendedProps: {
                                type: 'lifelog',
                                logType: data[ATTRS.type],
                                content: data[ATTRS.content],
                                blockId: blockId,
                                references: data.references,
                            }
                        };

                        events.push(eventData);
                        dayEvents.push(eventData); // 同时添加到当天事件数组
                    }

                    // 记录本日收尾信息供次日首事件使用
                    hasPrevDayData = items.length > 0;
                    if (hasPrevDayData) {
                        lastDayLastEventEndTime = items[items.length - 1][1][ATTRS.time];
                    } else {
                        lastDayLastEventEndTime = null;
                    }

                    // 将当天的事件存入缓存
                    this.dayEventsCache.set(dateStr, { events: dayEvents, timestamp: now });
                }

                // 推进到下一天
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // 清理过期缓存
            this.cleanupExpiredCache();

            return events;
        } catch (error) {
            console.error('获取 Lifelog 事件失败:', error);
            return [];
        }
    }

    /**
     * 获取 Lifelog 事件（带缓存）。在缓存有效期内返回缓存，超时则重新计算。
     */
    static async getLifelogEventsCached(start?: Date, end?: Date): Promise<EventInput[]> {
        if (!start || !end) return [];
        if (this.isDirty()) {
            this.clearCache();
        }
        // 直接调用改造后的getLifelogEvents函数，它现在内置了按天缓存的逻辑
        const events = await this.getLifelogEvents(start, end);
        // 清除脏标记
        this.clearDirty();

        return events;
    }
}
