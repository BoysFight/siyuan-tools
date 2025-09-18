import { EventInput } from '@fullcalendar/core';
import { getBlockAttrs, sql, getBlockKramdown, setBlockAttrs } from '../api/api';
import { ATTRS } from '../lifelog/module-lifelog';

export class LifelogView {
    private static lastProcessTime: number = 0;
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
            console.log(`已更新块 ${blockId} 的属性:`, needsUpdate);
        }

        return { relevantAttrs, references };
    }
    static async getLifelogEvents(start?: Date, end?: Date): Promise<EventInput[]> {
        try {
            if (!start || !end) {
                return [];
            }

            const events: EventInput[] = [];
            const currentDate = new Date(start);
            let lastDayLastEventEndTime = '23:59:59';  // 默认起始时间

            const now = Date.now();
            const timeDiff = now - LifelogView.lastProcessTime;
            // 计算日期间隔
            const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            const shouldUpdate = daysDiff === 1 && timeDiff >= 30*1000; // 30s
            // 处理块的属性，默认不进行属性对比修改
            if (shouldUpdate) {
                LifelogView.lastProcessTime = now;
            }

            // 循环遍历从开始日期到结束日期的每一天
            while (currentDate <= end) {
                const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '/');

                // 构建当天的 SQL 查询语句
                const blockIdsQuery = `
                    SELECT DISTINCT block_id
                    FROM attributes
                    WHERE name = '${ATTRS.date}' AND value = '${dateStr}'
                `;

                const blockIdsResult = await sql(blockIdsQuery);
                const blockIds = blockIdsResult.map((item: any) => item.block_id);

                if (blockIds.length === 0) {
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

                for (let i = 0; i < items.length; i++) {
                    const [blockId, data] = items[i];
                    const endTime = data[ATTRS.time];
                    let eventStartTime, eventStartDate;

                    if (i === 0) {
                        eventStartTime = lastDayLastEventEndTime;
                        // 如果是当天第一个事件且开始时间是前一天的结束时间
                        // 则需要使用前一天的日期
                        const prevDate = new Date(currentDate);
                        prevDate.setDate(prevDate.getDate() - 1);
                        eventStartDate = prevDate.toISOString().split('T')[0].replace(/-/g, '/');
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
                }

                // 更新lastDayLastEventEndTime为当天最后一个事件的结束时间
                // 如果当天没有事件，保持上一次的lastDayLastEventEndTime不变
                if (items.length > 0) {
                    lastDayLastEventEndTime = items[items.length - 1][1][ATTRS.time];
                }

                currentDate.setDate(currentDate.getDate() + 1);
            }

            return events;
        } catch (error) {
            console.error('获取 Lifelog 事件失败:', error);
            return [];
        }
    }
}