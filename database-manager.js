// 功能：自动添加文档到数据库并支持手动添加块到数据库
// version 0.0.1

(() => {
    // 配置
    const CONFIG = {
        // 是否开启同时添加其他字段
        isEnableMoreCols: true,
        // 是否同时对选中块添加自定义属性
        isEnableCustomAttrsInSelectedBlock: true,
        // 防抖延迟时间（毫秒）
        debounceDelay: 1000
    };

    // 数据库规则配置
    const DATABASE_RULES = [
        {
            name: '项目文档数据库',
            dbBlockId: '20240918154915-8ktx2i4',
            notebookID: '20230323101042-0iji3w9',
            pathPattern: /^\/20240430105640-waf30sl\//i,
            titlePattern: /^(Story|Epic|Feature)-/i,
            isBindBlock: true,
            customAttrs: {},
            otherCols: [
                {
                    colName: '父项目',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        try {
                            const blockInfo = await getBlockByID(rowID);
                            const docId = blockInfo.root_id;
                            const docInfo = await getBlockByID(docId);
                            const hpath = docInfo?.['hpath'];
                            const path = docInfo?.['path'];

                            if (!hpath && !path) {
                                console.warn('文档缺少 hpath 和 path 属性');
                                return {type: "relation", relation: {blockIDs: [], contents: []}, id: cellID};
                            }

                            const parentPaths = hpath.split('/').filter(p => p);
                            const parentIds = path.split('/').filter(id => id);

                            for (let i = parentPaths.length - 2; i >= 0; i--) {
                                const parentPath = parentPaths[i];
                                const parentId = parentIds[i];

                                if (parentPath.startsWith('Epic') || parentPath.startsWith('Feature') || parentPath.startsWith('Story')) {
                                    return {
                                        type: "relation",
                                        relation: {
                                            blockIDs: [parentId],
                                            contents: []
                                        },
                                        id: cellID
                                    };
                                }
                            }

                            return {type: "relation", relation: {blockIDs: [], contents: []}, id: cellID};
                        } catch (error) {
                            console.error('获取父项目失败:', error);
                            return {type: "relation", relation: {blockIDs: [], contents: []}, id: cellID};
                        }
                    }
                },
                {
                    colName: '文章库',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        try {
                            const blockInfo = await getBlockByID(rowID);
                            const docId = blockInfo.root_id;

                            const sql = `
                            SELECT DISTINCT r.def_block_root_id
                            FROM refs r
                            INNER JOIN blocks b ON r.def_block_root_id = b.id
                            WHERE r.root_id = '${docId}'
                            AND b.ial LIKE '%custom-avs="20240915110837-kkim7yn"%'
                            `;
                            const refs = await requestApi('/api/query/sql', {stmt: sql});

                            if (refs.code !== 0 || !refs.data || !refs.data.length) {
                                console.info('未找到引用关系');
                                return {type: "relation", relation: {blockIDs: [], contents: []}, id: cellID};
                            }

                            const articleBlockIds = refs.data.map(ref => ref.def_block_root_id);

                            return {
                                type: "relation",
                                relation: {
                                    blockIDs: articleBlockIds,
                                    contents: []
                                },
                                id: cellID
                            };
                        } catch (error) {
                            console.error('获取文章库引用失败:', error);
                            return {type: "relation", relation: {blockIDs: [], contents: []}, id: cellID};
                        }
                    }
                }
            ]
        },
        {
            name: '文章数据库',
            dbBlockId: '20240915110837-quim9ts',
            notebookID: '20230322123651-tsuyuox',
            pathPattern: /^\/\d{14}-[a-z0-9]{7}\.sy$/,
            titlePattern: null,
            isBindBlock: true,
            customAttrs: {},
            otherCols: []
        },
        {
            name: '日程数据库',
            dbBlockId: '20250113200532-y2n64lu',
            isBindBlock: true,
            customAttrs: {"custom-st-event": "todo"},
            otherCols: [
                {
                    colName: '主事件',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"type": "checkbox", "checkbox": {"checked":true}};
                    }
                },
                {
                    colName: '状态',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"未完成"}]};
                    }
                },
                {
                    colName: '优先级',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"中"}]};
                    }
                },
                {
                    colName: '分类',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"工作"}]};
                    }
                },
                {
                    colName: '开始时间',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        return {"date": {"content": today.getTime(), "content2": 0, "isNotEmpty": true, "isNotEmpty2": false, "isNotTime": false, "hasEndDate": false}};
                    }
                },
                {
                    colName: '项目',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        try {
                            console.info(`开始处理项目关联 - rowID: ${rowID}, avID: ${avID}`);

                            const blockInfo = await requestApi('/api/block/getBlockInfo', {id: rowID});
                            if (blockInfo?.code !== 0) {
                                console.error(`获取块信息失败 - rowID: ${rowID}, 错误信息: ${blockInfo?.msg}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }
                            if (!blockInfo.data?.rootID) {
                                console.warn(`块没有根文档ID - rowID: ${rowID}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const docId = blockInfo.data.rootID;
                            const docInfo = await requestApi('/api/block/getBlockInfo', {id: docId});
                            if (docInfo?.code !== 0) {
                                console.error(`获取根文档信息失败 - rootID: ${docId}, 错误信息: ${docInfo?.msg}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const docTitle = docInfo.data?.rootTitle?.trim();
                            if (!docTitle) {
                                console.warn(`根文档标题为空 - rootID: ${docId}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const validPrefixes = ['Epic', 'Feature', 'Story'];
                            const hasValidPrefix = validPrefixes.some(prefix => docTitle.startsWith(prefix));
                            if (!hasValidPrefix) {
                                console.info(`文档类型不符合要求 - title: ${docTitle}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const docAttrs = await requestApi('/api/attr/getBlockAttrs', {id: docId});
                            if (!docAttrs?.data) {
                                console.warn(`获取根文档属性失败 - rootID: ${docId}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            if (!docAttrs.data['custom-avs']) {
                                console.warn(`文档缺少必要属性 custom-avs - rootID: ${docId}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const currentValues = existingValues;
                            const blockIdsToAdd = new Set();

                            const currentBlock = await getBlockByID(rowID);
                            let hasValidRefs = false;
                            if (currentBlock && currentBlock.markdown) {
                                const refMatches = currentBlock.markdown.match(/\(\(([\w-]+)\s+'[^']*'\)\)/g);
                                if (refMatches) {
                                    for (const match of refMatches) {
                                        const blockId = match.match(/\(\(([\w-]+)/)[1];
                                        const refBlock = await getBlockByID(blockId);

                                        if (refBlock && refBlock.type === 'd' &&
                                            (refBlock.content.startsWith('Epic-') ||
                                             refBlock.content.startsWith('Feature-') ||
                                             refBlock.content.startsWith('Story-'))) {
                                            blockIdsToAdd.add(blockId);
                                            hasValidRefs = true;
                                        }
                                    }
                                }
                            }

                            if (!hasValidRefs) {
                                blockIdsToAdd.add(docId);
                            }

                            const existingBlockIds = new Set(
                                currentValues.flatMap(value => [
                                    value.block?.id,
                                    ...(value.relation?.blockIDs || [])
                                ]).filter(Boolean)
                            );

                            const newBlockIDs = [...blockIdsToAdd].filter(id => !existingBlockIds.has(id));

                            if (newBlockIDs.length > 0) {
                                const allBlockIDs = [...(currentValues[0]?.relation?.blockIDs || []), ...newBlockIDs];
                                const newContents = [];
                                for (const blockId of newBlockIDs) {
                                    const block = await getBlockByID(blockId);
                                    if (block) {
                                        newContents.push({
                                            type: "block",
                                            blockID: blockId,
                                            block: {
                                                id: blockId,
                                                content: block.content
                                            },
                                            isDetached: false
                                        });
                                    }
                                }

                                return {
                                    type: "relation",
                                    relation: {
                                        blockIDs: allBlockIDs,
                                        contents: [...(currentValues[0]?.relation?.contents || []), ...newContents]
                                    },
                                    id: cellID
                                };
                            }

                            return {
                                type: "relation",
                                "relation": currentValues[0]?.relation || { blockIDs: [], contents: [] },
                                id: cellID
                            };

                        } catch (error) {
                            console.error('获取项目信息失败:', error);
                            console.error('错误详情:', {
                                message: error.message,
                                stack: error.stack,
                                rowID,
                                avID,
                                keyID,
                                cellID
                            });
                            return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                        }
                    }
                },
                {
                    colName: '父任务',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        try {
                            console.info(`开始处理父任务关联 - rowID: ${rowID}, avID: ${avID}`);

                            async function findNearestParentListItemBlock(blockId) {
                                let currentBlock = await getBlockByID(blockId);

                                while (currentBlock && currentBlock.parent_id) {
                                    const parentBlock = await getBlockByID(currentBlock.parent_id);
                                    if (parentBlock && parentBlock.type === 'i') {
                                        return parentBlock.id;
                                    }
                                    currentBlock = parentBlock;
                                }
                                return null;
                            }

                            const parentTaskId = await findNearestParentListItemBlock(rowID);
                            if (!parentTaskId) {
                                console.info(`未找到父任务 - rowID: ${rowID}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const parentAttrs = await requestApi('/api/attr/getBlockAttrs', {id: parentTaskId});
                            if (!parentAttrs?.data?.['custom-st-event']) {
                                console.info(`父节点不在数据库中 - parentID: ${parentTaskId}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            const currentValues = existingValues || [];
                            const relationExists = currentValues.some(
                                value => value.block?.id === parentTaskId || value.relation?.blockIDs?.includes(parentTaskId)
                            );

                            if (!relationExists) {
                                const newBlockIDs = [...(currentValues[0]?.relation?.blockIDs || []), parentTaskId];
                                return {
                                    "type": "relation",
                                    "relation": {
                                        "blockIDs": newBlockIDs,
                                        "contents": []
                                    },
                                    "id": cellID
                                };
                            }

                            return currentValues[0] || {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                        } catch (error) {
                            console.error(`处理父任务关联时发生错误: ${error.message}`);
                            return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                        }
                    }
                }
            ]
        }
    ];

    // 全局状态
    const STATE = {
        isProcessing: false,
        processedNotes: new Set(),
        lastProcessTimes: new Map()
    };

    // 工具函数
    const requestApi = async (url, data) => {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }).then(response => response.json());
    };

    const utils = {
        showMessage: (message, isError = false, delay = 7000) => {
            return fetch('/api/notification/' + (isError ? 'pushErrMsg' : 'pushMsg'), {
                method: 'POST',
                body: JSON.stringify({
                    msg: message,
                    timeout: delay
                })
            });
        },

        matchDatabaseRule: (notebookId, path, title) => {
            return DATABASE_RULES.find(rule => {
                const matchNotebook = !rule.notebookID || rule.notebookID === notebookId;
                const matchPath = !rule.pathPattern || rule.pathPattern.test(path);
                const matchTitle = !rule.titlePattern || rule.titlePattern.test(title);
                return matchNotebook && matchPath && matchTitle;
            });
        },

        extractDocId: (path) => {
            const match = path.match(/\d{14}-[a-z0-9]{7}(?=\.sy$)/);
            return match ? match[0] : null;
        },

        scheduleDocProcess: (docId, dbBlockId = null, delay = CONFIG.debounceDelay) => {
            const now = Date.now();
            const lastTime = STATE.lastProcessTimes.get(docId);

            if (lastTime) {
                clearTimeout(lastTime.timerId);
            }

            const timerId = setTimeout(() => {
                handleDocAdded(docId, dbBlockId);
                STATE.lastProcessTimes.delete(docId);
            }, delay);

            STATE.lastProcessTimes.set(docId, { timestamp: now, timerId });
        },

        getCursorElement: () => {
            const selection = window.getSelection();
            if (!selection.rangeCount) return null;
            const range = selection.getRangeAt(0);
            return range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
        },

        whenElementExist: (selector, node) => {
            return new Promise(resolve => {
                const check = () => {
                    const el = typeof selector === 'function' ? selector() : (node || document).querySelector(selector);
                    if (el) resolve(el); else requestAnimationFrame(check);
                };
                check();
            });
        },

        observeBlockMenu: (selector, callback) => {
            let hasFlag1 = false;
            let hasFlag2 = false;
            let isTitleMenu = false;

            const observer = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if ((hasFlag1 && hasFlag2) || isTitleMenu) return;
                            if (node.nodeType === 1 && node.querySelector('.b3-menu__label')?.textContent?.trim() === window.siyuan.languages.cut) {
                                hasFlag1 = true;
                            }
                            if (node.nodeType === 1 && node.querySelector('.b3-menu__label')?.textContent?.trim() === window.siyuan.languages.move) {
                                hasFlag2 = true;
                            }
                            if (node.nodeType === 1 && node.closest('[data-name="titleMenu"]')) {
                                isTitleMenu = true;
                            }
                            if ((hasFlag1 && hasFlag2) || isTitleMenu) {
                                callback(isTitleMenu);
                                setTimeout(() => {
                                    hasFlag1 = false;
                                    hasFlag2 = false;
                                    isTitleMenu = false;
                                }, 200);
                            }
                        });
                    }
                }
            });

            observer.observe(selector || document.body, {
                childList: true,
                subtree: false,
            });

            return observer;
        }
    };

    // 数据库操作函数
    const dbOperations = {
        getAvIdByAvBlockId: async (blockId) => {
            const av = await dbOperations.getAvBySql(`SELECT * FROM blocks where type ='av' and id='${blockId}'`);
            if (av.length === 0) return '';
            const avId = av.map(av => dbOperations.getDataAvIdFromHtml(av.markdown))[0];
            return avId || '';
        },

        getDataAvIdFromHtml: (htmlString) => {
            const match = htmlString.match(/data-av-id="([^"]+)"/);
            return match?.[1] || "";
        },

        getAvBySql: async (sql) => {
            const result = await requestApi('/api/query/sql', {"stmt": sql});
            if (result.code !== 0) {
                console.error("查询数据库出错", result.msg);
                return [];
            }
            return result.data;
        },

        getBlockByID: async (blockId) => {
            const sqlScript = `select * from blocks where id ='${blockId}'`;
            const data = await dbOperations.getAvBySql(sqlScript);
            return data[0];
        },

        addBlocksToAv: async (blockIds, avId, avBlockID) => {
            blockIds = typeof blockIds === 'string' ? [blockIds] : blockIds;
            const srcs = blockIds.map(blockId => ({
                "id": blockId,
                "isDetached": false,
            }));
            const input = {
                "avID": avId,
                "blockID": avBlockID,
                'srcs': srcs
            };
            const result = await requestApi('/api/av/addAttributeViewBlocks', input);
            if (!result || result.code !== 0) console.error(result);
        },

        addColsToAv: async (blockIds, cols, avID) => {
            blockIds = typeof blockIds === 'string' ? [blockIds] : blockIds;
            for (const blockId of blockIds) {
                for (const col of cols) {
                    if (!col.keyID) continue;
                    const { cellID, values } = await dbOperations.getCellIdByRowIdAndKeyId(blockId, col.keyID, avID);
                    if (!cellID) continue;
                    let colData = { avID: avID, keyID: col.keyID, rowID: blockId, cellID };
                    if (typeof col.getColValue !== 'function') continue;
                    const colValue = await col.getColValue(col.keyID, blockId, cellID, avID, values);
                    if (typeof colValue !== 'object') continue;
                    colData.value = colValue;
                    const result = await requestApi("/api/av/setAttributeViewBlockAttr", colData);
                    if (!result || result.code !== 0) console.error(result);
                }
            }
        },

        getCellIdByRowIdAndKeyId: async (rowID, keyID, avID) => {
            try {
                const cacheKey = `${rowID}-${avID}`;
                const now = Date.now();
                const cached = avKeysCache.get(cacheKey);

                if (!cached || now - cached.timestamp > CACHE_TIMEOUT) {
                    const res = await requestApi("/api/av/getAttributeViewKeys", { id: rowID });
                    avKeysCache.set(cacheKey, {
                        data: res.data,
                        timestamp: now
                    });
                }

                const cachedData = avKeysCache.get(cacheKey).data;
                const foundItem = cachedData.find(item => item.avID === avID);

                if (foundItem && foundItem.keyValues) {
                    const specificKey = foundItem.keyValues.find(kv => kv.key.id === keyID);
                    if (specificKey && specificKey.values && specificKey.values.length > 0) {
                        return {
                            cellID: specificKey.values[0].id,
                            values: specificKey.values
                        };
                    }
                }
                return { cellID: null, values: [] };
            } catch (error) {
                console.error('Error in getCellIdByRowIdAndKeyId:', error);
                return { cellID: null, values: [] };
            }
        },

        addBlocksToAvNoBind: async (blocks, avId, pkKeyID, keyID, otherCols) => {
            const values = await Promise.all([...blocks].map(async block => {
                const rowValues = [{
                    "keyID": pkKeyID,
                    "block": {
                        "content": keyID ? "" : block.textContent
                    }
                }];

                if (keyID) {
                    rowValues.push({
                        "keyID": keyID,
                        "text": {
                            "content": block.textContent
                        }
                    });
                }

                if (CONFIG.isEnableMoreCols && otherCols && otherCols.length > 0) {
                    for (const col of otherCols) {
                        if (!col.keyID) continue;
                        let colData = { "keyID": col.keyID };
                        if (typeof col.getColValue !== 'function') continue;
                        const colValue = await col.getColValue(col.keyID);
                        if (typeof colValue !== 'object') continue;
                        colData = { ...colData, ...colValue };
                        rowValues.push(colData);
                    }
                }
                return rowValues;
            }));

            const input = {
                "avID": avId,
                "blocksValues": values,
            };
            const result = await requestApi('/api/av/appendAttributeViewDetachedBlocksWithValues', input);
            if (!result || result.code !== 0) console.error(result);
        },

        setBlocksAttrs: async (blockIds, attrs) => {
            if (typeof attrs !== 'object') return;
            for (const blockId of blockIds) {
                if (!blockId) continue;
                const result = await requestApi('/api/attr/setBlockAttrs', {
                    "id": blockId,
                    "attrs": attrs
                });
                if (!result || result.code !== 0) console.error(result);
            }
        }
    };

    // API 处理器
    const API_HANDLERS = {
        '/api/filetree/createDailyNote': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const notebookID = '20220429170842-o80xrr2';
                    const boxid = window.siyuan.storage["local-dailynoteid"];
                    if (boxid !== notebookID) {
                        console.log('非目标笔记本，跳过');
                        return null;
                    }
                    return { dbBlockId: '20231009174308-8c1fkzi', isMultiDoc: false };
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                if (!result?.data?.id) return;
                console.log(`开始处理日记 ${result.data.id}...`);
                utils.scheduleDocProcess(result.data.id, docInfo.dbBlockId, 0);
            }
        },
        '/api/filetree/renameDoc': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    if (!(params && typeof params.notebook === 'string' &&
                          typeof params.path === 'string' &&
                          typeof params.title === 'string')) {
                        return null;
                    }

                    const matchedRule = utils.matchDatabaseRule(params.notebook, params.path, params.title);
                    if (!matchedRule) return null;

                    const docId = utils.extractDocId(params.path);
                    if (!docId) return null;

                    return { docId, dbBlockId: matchedRule.dbBlockId, rule: matchedRule };
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                console.log(`开始处理文档 ${docInfo.docId}...`);
                utils.scheduleDocProcess(docInfo.docId, docInfo.dbBlockId);
            }
        },
        '/api/filetree/createDoc': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    if (!(params && typeof params.notebook === 'string' &&
                          typeof params.path === 'string' &&
                          typeof params.title === 'string')) {
                        return null;
                    }

                    const matchedRule = utils.matchDatabaseRule(params.notebook, params.path, params.title);
                    if (!matchedRule) return null;

                    const docId = utils.extractDocId(params.path);
                    if (!docId) return null;

                    return { docId, dbBlockId: matchedRule.dbBlockId, rule: matchedRule };
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                console.log(`开始处理文档 ${docInfo.docId}...`);
                utils.scheduleDocProcess(docInfo.docId, docInfo.dbBlockId);
            }
        }
    };

    // 缓存配置
    const CACHE_TIMEOUT = 5 * 60 * 1000; // 5分钟
    const avKeysCache = new Map();

    // 缓存清理函数
    const clearCache = () => {
        const now = Date.now();
        for (const [key, value] of avKeysCache.entries()) {
            if (now - value.timestamp > CACHE_TIMEOUT) {
                avKeysCache.delete(key);
            }
        }
    };

    // 定期清理缓存
    setInterval(clearCache, CACHE_TIMEOUT);

    // 处理文档添加事件
    const handleDocAdded = async (docId, dbBlockId = null) => {
        if (STATE.isProcessing || STATE.processedNotes.has(docId)) return;
        STATE.isProcessing = true;

        try {
            const docInfo = await requestApi('/api/block/getBlockInfo', { id: docId });
            if (!docInfo || docInfo.code !== 0) {
                console.error('获取文档信息失败:', docInfo?.msg);
                return;
            }

            const { notebook, path, title } = {
                notebook: docInfo.data.box,
                path: docInfo.data.path,
                title: docInfo.data.content
            };

            const matchedRule = dbBlockId ? DATABASE_RULES.find(rule => rule.dbBlockId === dbBlockId) :
                                          utils.matchDatabaseRule(notebook, path, title);
            if (!matchedRule) {
                console.log('文档不符合数据库规则');
                return;
            }

            const avId = await dbOperations.getAvIdByAvBlockId(matchedRule.dbBlockId);
            if (!avId) {
                console.error('获取数据库ID失败');
                return;
            }

            await dbOperations.addBlocksToAv([docId], avId, matchedRule.dbBlockId);
            if (matchedRule.customAttrs && Object.keys(matchedRule.customAttrs).length > 0) {
                await dbOperations.setBlocksAttrs([docId], matchedRule.customAttrs);
            }

            if (matchedRule.otherCols && matchedRule.otherCols.length > 0) {
                await dbOperations.addColsToAv([docId], matchedRule.otherCols, avId);
            }

            STATE.processedNotes.add(docId);
            utils.showMessage(`已将文档添加到${matchedRule.name}`);
        } catch (error) {
            console.error('处理文档时出错:', error);
            utils.showMessage('处理文档时出错: ' + error.message, true);
        } finally {
            STATE.isProcessing = false;
        }
    };

    // 处理手动添加块到数据库
    const menuItemClick = async (blockId, avBlockId, isBindBlock = true, isTitle = false) => {
        try {
            const avId = await dbOperations.getAvIdByAvBlockId(avBlockId);
            if (!avId) {
                utils.showMessage('获取数据库ID失败', true);
                return;
            }

            const matchedRule = DATABASE_RULES.find(rule => rule.dbBlockId === avBlockId);
            if (!matchedRule) {
                utils.showMessage('未找到匹配的数据库规则', true);
                return;
            }

            if (isBindBlock) {
                await dbOperations.addBlocksToAv([blockId], avId, avBlockId);
                if (matchedRule.customAttrs && Object.keys(matchedRule.customAttrs).length > 0) {
                    await dbOperations.setBlocksAttrs([blockId], matchedRule.customAttrs);
                }
                if (matchedRule.otherCols && matchedRule.otherCols.length > 0) {
                    await dbOperations.addColsToAv([blockId], matchedRule.otherCols, avId);
                }
            } else {
                const block = await dbOperations.getBlockByID(blockId);
                if (!block) {
                    utils.showMessage('获取块信息失败', true);
                    return;
                }
                await dbOperations.addBlocksToAvNoBind([block], avId, matchedRule.pkKeyID, matchedRule.keyID, matchedRule.otherCols);
            }

            utils.showMessage(`已添加到${matchedRule.name}`);
        } catch (error) {
            console.error('添加到数据库时出错:', error);
            utils.showMessage('添加到数据库时出错: ' + error.message, true);
        }
    };

    // 处理快捷键
    const handleHotkey = async () => {
        const cursorElement = utils.getCursorElement();
        if (!cursorElement) return;

        const protyleElement = cursorElement.closest('.protyle-wysiwyg');
        if (!protyleElement) return;

        const blockElement = cursorElement.closest('[data-node-id]');
        if (!blockElement) return;

        const blockId = blockElement.getAttribute('data-node-id');
        const isTitle = blockElement.getAttribute('data-type') === 'NodeHeading';

        for (const rule of DATABASE_RULES) {
            if (rule.isBindBlock) {
                await menuItemClick(blockId, rule.dbBlockId, true, isTitle);
            }
        }
    };

    // 监听块菜单
    const observeBlockMenu = () => {
        utils.observeBlockMenu(null, (isTitleMenu) => {
            const menuContainer = document.querySelector('.b3-menu__items');
            if (!menuContainer) return;

            const separator = document.createElement('div');
            separator.className = 'b3-menu__separator';
            menuContainer.appendChild(separator);

            const submenuItem = document.createElement('button');
            submenuItem.className = 'b3-menu__item';
            submenuItem.innerHTML = `
                <span class="b3-menu__label">添加到数据库</span>
                <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
            `;
            menuContainer.appendChild(submenuItem);

            const submenu = document.createElement('div');
            submenu.className = 'b3-menu__submenu';
            submenuItem.appendChild(submenu);

            DATABASE_RULES.forEach(rule => {
                const menuItem = document.createElement('button');
                menuItem.className = 'b3-menu__item';
                menuItem.innerHTML = `<span class="b3-menu__label">${rule.name}</span>`;
                submenu.appendChild(menuItem);

                menuItem.addEventListener('click', () => {
                    const blockElement = document.querySelector('.block--highlight[data-node-id], .block--hl[data-node-id]');
                    if (!blockElement) return;
                    const blockId = blockElement.getAttribute('data-node-id');
                    menuItemClick(blockId, rule.dbBlockId, rule.isBindBlock, isTitleMenu);
                });
            });
        });
    };

    // 初始化
    const init = () => {
        // 监听 API 请求
        const originalFetch = window.fetch;
        window.fetch = async function (url, options) {
            const response = await originalFetch(url, options);
            const clonedResponse = response.clone();

            try {
                const urlObj = new URL(url, window.location.origin);
                const handler = API_HANDLERS[urlObj.pathname];

                if (handler && (!handler.method || handler.method === options?.method)) {
                    const docInfo = handler.validateParams(options?.body);
                    if (docInfo) {
                        const result = await clonedResponse.json();
                        handler.processResult(result, docInfo);
                    }
                }
            } catch (error) {
                console.error('处理API请求时出错:', error);
            }

            return response;
        };

        // 注册快捷键
        window.addEventListener('keydown', (event) => {
            if (event.altKey && event.key.toLowerCase() === 'x') {
                event.preventDefault();
                handleHotkey();
            }
        });

        // 监听块菜单
        observeBlockMenu();
    };

    // 启动
    init();
})();