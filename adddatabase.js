// 添加块到指定数据库(项目库，日程库)（支持绑定块和不绑定块，支持文档块和普通块）
// see https://ld246.com/article/1746153210116
// 注意：只能在块菜单中操作（你的右键可能不是块菜单）
// 本应用已全部用完Achuan-2大佬提供的所有api see https://ld246.com/article/1733365731025
// version 0.0.8
// 0.0.2 （已废弃）
// 0.0.3 修改参数配置方式
// 0.0.4 修复仅对当前文档中的选中块起作用
// 0.0.5 支持叶归等第三方非标准思源dom结构
// 0.0.6 增加附加字段功能
// 0.0.7 增加可同时对选中块增加自定义属性
// 0.0.8 修复批量调添加可能扩展字段无法被添加的意外情况
(()=>{
    // 是否开启，同时添加其他字段 true 开启 false 不开启
    // 开启时，需要配置menus中的otherCols字段信息（可参考下面的示例）
    const isEnableMoreCols = true;

    // 是否同时对选中块添加自定义属性（需要在menus中配置customAttrs，每个菜单可以添加不同的自定义属性）
    const isEnableCustomAttrsInSelectedBlock = true;

    // 块菜单配置
    const menus = [
        {
            // 菜单名，显示在块或文档右键菜单上
            name: "更新日程数据库",
            // 添加到的数据库块id列表（必填），注意是数据库所在块id，如果移动了数据库位置需要更改
            toAvBlockId: "20250113200532-y2n64lu",
            // 指定数据库的列名，不填默认是添加到主键列，该参数仅对不绑定块菜单有效，如果多个列名一样的则取第一个
            // 注意，目前仅支持文本列
            toAvColName: "",
            // 是否绑定块菜单，true 绑定，false 不绑定
            isBindBlock: true,
            // 给选中块添加自定义属性，可以按key:value形式添加多组
            // 注意，自定义属性需要添加custom-前缀
            customAttrs: {"custom-st-event": "todo"},
            // 其他扩展字段（需要时把注释打开后配置即可）
            // getColValue回调函数可动态计算字段值返回
            otherCols: [
                {
                    colName: '主事件',
                    // 对于绑定块，块/文档id === rowID
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"type": "checkbox", "checkbox": {"checked":true}};
                    },
                },
                {
                    colName: '全天',
                    // 对于绑定块，块/文档id === rowID
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"type": "checkbox", "checkbox": {"checked":true}};
                    },
                },
                {
                    colName: '状态',
                    // 对于绑定块，块/文档id === rowID
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"未完成"}]};
                    },
                },
                {
                    colName: '优先级',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"中"}]};
                    },
                },
                {
                    colName: '分类',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"工作"}]};
                    },
                },
                {
                    colName: '开始时间',
                    getColValue: (keyID, rowID, cellID, avID) => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        return {"date": {"content": today.getTime(), "content2": today.getTime(), "isNotEmpty": true, "isNotEmpty2": true, "isNotTime": false, "hasEndDate": true}};
                    },
                },
                {
                    colName: '项目',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        // 预定义空关系返回值，避免重复创建
                        // 高效处理现有关系
                        const existingBlockIds = new Set(
                            (existingValues || []).flatMap(value => [
                                value.block?.id,
                                ...(value.relation?.blockIDs || [])
                            ]).filter(Boolean)
                        );
                        const emptyRelation = {"type": "relation", "relation": {"blockIDs": [...new Set([...existingBlockIds])], "contents": []}, "id": cellID};

                        if (!rowID) {
                            console.warn('缺少必要参数 rowID');
                            return emptyRelation;
                        }

                        try {
                            // 获取当前块内容并检查引用
                            const currentBlock = await getBlockByID(rowID);
                            if (!currentBlock?.markdown) {
                                return emptyRelation;
                            }

                            // 优化的正则表达式，一次性提取所有引用ID
                            const blockIdsToAdd = new Set();
                            const refRegex = /\(\(([\w-]+)\s+'[^']*'\)\)/g;
                            const refIds = [...currentBlock.markdown.matchAll(refRegex)].map(match => match[1]);

                            if (refIds.length > 0) {
                                // 批量获取所有引用块信息
                                const refBlocks = await Promise.all(
                                    refIds.map(id => getBlockByID(id))
                                );

                                // 检查每个引用块
                                refBlocks.forEach((refBlock, index) => {
                                    if (refBlock?.type === 'd' &&
                                        ['Epic-', 'Feature-', 'Story-'].some(prefix => refBlock.content.startsWith(prefix))) {
                                        blockIdsToAdd.add(refIds[index]);
                                    }
                                });
                            }
                            {
                                // 递归获取父块引用
                                const checkParentBlockRefs = async (block) => {
                                    if (!block?.parent_id) return null;

                                    const parentBlock = await getBlockByID(block.parent_id);
                                    if (!parentBlock) return null;

                                    if (parentBlock.type === 'i' && parentBlock.markdown) {
                                        const refMatches = [...(parentBlock.markdown.matchAll(/\(\(([\w-]+)\s+'[^']*'\)\)/g))]
                                            .map(match => match[1]);

                                        if (refMatches.length > 0) {
                                            const refBlocks = await Promise.all(
                                                refMatches.map(id => getBlockByID(id))
                                            );

                                            const validRef = refBlocks.find((refBlock, index) =>
                                                refBlock?.type === 'd' &&
                                                ['Epic-', 'Feature-', 'Story-'].some(prefix =>
                                                    refBlock.content.startsWith(prefix)
                                                )
                                            );

                                            if (validRef) {
                                                return refMatches[refBlocks.indexOf(validRef)];
                                            }
                                        }
                                    }
                                    return checkParentBlockRefs(parentBlock);
                                };

                                const validParentRef = await checkParentBlockRefs(currentBlock);
                                if (validParentRef) {
                                    blockIdsToAdd.add(validParentRef);
                                }
                            }

                            // 如果没有找到有效的引用，添加当前文档
                            if (blockIdsToAdd.size === 0) {
                                // 并行获取块信息和文档信息
                                docId = currentBlock.root_id
                                const docBlock = await getBlockByID(docId);
                                if (!docBlock) {
                                    console.warn(`获取文档块失败 - docId: ${docId}`);
                                    return emptyRelation;
                                }

                                // 验证文档标题
                                const docTitle = docBlock.content?.trim();
                                if (!docTitle) {
                                    console.warn(`文档标题为空 - docId: ${docId}`);
                                    return emptyRelation;
                                }

                                // 验证文档类型
                                if (!['Epic-', 'Feature-', 'Story-'].some(prefix => docTitle.startsWith(prefix))) {
                                    console.info(`文档类型不符合要求 - title: ${docTitle}`);
                                    return emptyRelation;
                                }

                                blockIdsToAdd.add(docId);
                            }

                            // 构建最终的关系对象
                            return {
                                type: "relation",
                                relation: {
                                    blockIDs: [...new Set([...existingBlockIds, ...blockIdsToAdd])],
                                    contents: []
                                },
                                id: cellID
                            };

                        } catch (error) {
                            console.error('处理项目关联时发生错误:', error);
                            return emptyRelation;
                        }
                    },
                },
                {
                    colName: '父任务',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        try {
                            console.info(`开始处理父任务关联 - rowID: ${rowID}, avID: ${avID}`);

                            // 添加获取最近上级列表项块的辅助函数
                            async function findNearestParentListItemBlock(blockId) {
                                let currentBlock = await getBlockByID(blockId);

                                while (currentBlock && currentBlock.parent_id) {
                                    const parentBlock = await getBlockByID(currentBlock.parent_id);
                                    if (parentBlock && parentBlock.type === 'i') {  // 'i' 表示列表项块
                                        return parentBlock.id;
                                    }
                                    currentBlock = parentBlock;
                                }
                                return null;
                            }

                            // 获取父任务ID
                            const parentTaskId = await findNearestParentListItemBlock(rowID);
                            if (!parentTaskId) {
                                console.info(`未找到父任务 - rowID: ${rowID}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            // 检查父节点是否在数据库中（通过检查属性）
                            const parentAttrs = await requestApi('/api/attr/getBlockAttrs', {id: parentTaskId});
                            if (!parentAttrs?.data?.['custom-st-event']) {
                                console.info(`父节点不在数据库中 - parentID: ${parentTaskId}`);
                                return {"type": "relation", "relation": {"blockIDs": [], "contents": []}, "id": cellID};
                            }

                            // 使用现有值或初始化新的关系数据
                            const currentValues = existingValues || [];

                            // 检查关系是否已存在
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
                    },
                }
            ],
        },
        {
            name: "更新项目数据库",
            toAvBlockId: "20240918154915-8ktx2i4", // 请替换为你的项目数据库块ID
            isBindBlock: true,
            customAttrs: {},
            otherCols: [
                {
                    colName: '项目状态',
                    // 对于绑定块，块/文档id === rowID
                    getColValue: (keyID, rowID, cellID, avID) => {
                        return {"mSelect": [{"content":"进行中"}]};
                    },
                },
                {
                    colName: '父项目',
                    getColValue: async (keyID, rowID, cellID, avID, existingValues) => {
                        try {
                            // 获取当前块的根文档
                            const blockInfo = await getBlockByID(rowID);
                            const docId = blockInfo.root_id;
                            const docInfo = await getBlockByID(docId);
                            const hpath = docInfo?.['hpath'];
                            const path = docInfo?.['path'];

                            if (!hpath && !path) {
                                console.warn('文档缺少 hpath 和 path 属性');
                                return {type: "relation", relation: {blockIDs: [], contents: []}, id: cellID};
                            }

                            // 使用 hpath 获取父文档路径，过滤掉空字符串
                            const parentPaths = hpath.split('/').filter(p => p);
                            // 使用 path 获取父文档ID，过滤掉空字符串
                            const parentIds = path.split('/').filter(id => id);

                            // 从近到远遍历父文档
                            for (let i = parentPaths.length - 2; i >= 0; i--) {
                                const parentPath = parentPaths[i];
                                const parentId = parentIds[i];

                                // 检查是否以 Epic、Feature 或 Story 开头
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
                            // 获取当前块的根文档
                            const blockInfo = await getBlockByID(rowID);
                            const docId = blockInfo.root_id;

                            // 修改 SQL 查询以获取文档中的所有引用的根文档
                            //custom-avs是对应数据库在av目录先的json文件的名字，不是复制数据库id的结果
                            //20240915110837-kkim7yn 是文章库的数据库id
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

                            // 检查每个引用文档是否在文章库中
                            const articleBlockIds = [];
                            for (const ref of refs.data) {
                                const refBlock = await getBlockByID(ref.def_block_root_id);
                                articleBlockIds.push(ref.def_block_root_id);
                            }

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
        }
    ];

    // 获取当前编辑器的函数
    function getCurrentProtyle() {
        // 优先获取当前焦点所在的编辑器
        const activeElement = document.activeElement;
        const focusedProtyle = activeElement?.closest('.protyle:not(.fn__none)');
        if (focusedProtyle) {
            return focusedProtyle;
        }

        // 其次获取活动窗口的编辑器
        const activeWndProtyle = document.querySelector('[data-type="wnd"].layout__wnd--active .protyle:not(.fn__none)');
        if (activeWndProtyle) {
            return activeWndProtyle;
        }

        // 最后获取任意可见编辑器
        return document.querySelector('[data-type="wnd"] .protyle:not(.fn__none)');
    }

    // 添加快捷键处理函数
    async function handleHotkey() {
        const protyle = getCurrentProtyle();
        if (!protyle) {
            console.warn('未找到可用的编辑器窗口');
            showMessage('请先打开一个文档', true, 3000);
            return;
        }

        // 获取光标所在块的 ID
        let cursorElement = getCursorElement();
        // 根据光标位置选择菜单配置
        const titleEl = protyle?.querySelector('.protyle-title') || document.querySelector('.protyle-title');
        const isTitle = titleEl?.contains(cursorElement);
        if (isTitle) {
            const menu = menus[0];
            try {
                await menuItemClick(menu.toAvBlockId, menu.toAvColName, menu.isBindBlock, menu.otherCols, menu.customAttrs, true, null);
                showMessage(`已添加到${menu.name}`, false, 3000);
            } catch (error) {
                showMessage(`添加到${menu.name}失败: ${error.message}`, true, 3000);
            }
        } else {
            let cursorElementId = cursorElement?.closest('[data-type]')?.getAttribute('data-node-id');

            // 如果光标在列表项中，获取列表项的 ID
            if (cursorElementId && cursorElement?.closest('.li')) {
                cursorElementId = cursorElement.closest('.li').getAttribute('data-node-id');
            } else {
                showMessage('请先将光标定位到一个列表块', true, 3000);
                return;
            }

            const menu = menus[1];
            // 创建一个包含当前块的数组
            const blocks = [{ dataset: { nodeId: cursorElementId } }];
            try {
                await menuItemClick(menu.toAvBlockId, menu.toAvColName, menu.isBindBlock, menu.otherCols, menu.customAttrs, false, blocks);
                showMessage(`已添加到${menu.name}`, false, 3000);
            } catch (error) {
                showMessage(`添加到${menu.name}失败: ${error.message}`, true, 3000);
            }
            }
    }

    // 获取光标所在元素
    function getCursorElement() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        return range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    }

    // 注册快捷键
    window.addEventListener('keydown', (event) => {
        // Alt + X
        if (event.altKey && event.key.toLowerCase() === 'x') {
            event.preventDefault();
            handleHotkey();
        }
    });

    // 监听块右键菜单
    whenElementExist('#commonMenu .b3-menu__items').then((menuItems) => {
        const menusReverse = menus.reverse();
        observeBlockMenu(menuItems, async (isTitleMenu)=>{
            if(menuItems.querySelector('.add-to-my-av')) return;
            const addAv = menuItems.querySelector('button[data-id="addToDatabase"]');
            if(!addAv) return;
            if(menus.length === 0) return;
            // 生成块菜单
            menusReverse.forEach((menu,index) => {
                const menuText = menu.name+ (menu.isBindBlock?'':'（不绑定块）');
                const menuIcon = '#iconDatabase';
                const menuClass = `add-to-my-av-${menu.toAvBlockId}-${menus.length-index-1}`;
                const menuButtonHtml = `<button class="b3-menu__item ${menuClass}"><svg class="b3-menu__icon " style=""><use xlink:href="${menuIcon}"></use></svg><span class="b3-menu__label">${menuText}</span></button>`;
                addAv.insertAdjacentHTML('afterend', menuButtonHtml);
                const menuBtn = menuItems.querySelector('.'+menuClass);
                // 块菜单点击事件
                menuBtn.onclick = async () => {
                    window.siyuan.menus.menu.remove();
                    menuItemClick(menu.toAvBlockId, menu.toAvColName, menu.isBindBlock, menu.otherCols, menu.customAttrs, isTitleMenu);
                };
            });
        });
    });

    // 修改 menuItemClick 函数，使用传入的 customBlocks
    async function menuItemClick(toAvBlockId, toAvColName, isBindBlock, otherCols, customAttrs, isTitleMenu, customBlocks) {
        const avId = await getAvIdByAvBlockId(toAvBlockId);
        if(!avId) {
            showMessage('未找到块ID'+toAvBlockId+'所在的数据库，请检查数据库块ID配置是否正确', true);
            return;
        }
        let blocks = customBlocks;
        if (!blocks) {
            const protyle = getCurrentProtyle();
            // 获取光标所在块的 ID
            let cursorElement = getCursorElement();

            if (!protyle) {
                console.warn('未找到可用的编辑器窗口');
                showMessage('请先打开一个文档', true, 3000);
                return;
            }
            if(isTitleMenu) {
                // 添加文档块到数据库
                const docTitleEl = protyle?.querySelector('.protyle-title') || document.querySelector('.protyle-title');
                const docId = docTitleEl?.dataset?.nodeId;
                const docTitle = docTitleEl?.querySelector('.protyle-title__input')?.textContent;
                blocks = [{
                    dataset: {nodeId: docId},
                    textContent: docTitle,
                }];
            } else {
                // 添加普通块到数据库
                let cursorElementId = cursorElement?.closest('[data-type]')?.getAttribute('data-node-id');

                // 如果光标在列表项中，获取列表项的 ID
                if (cursorElementId && cursorElement?.closest('.li')) {
                    cursorElementId = cursorElement.closest('.li').getAttribute('data-node-id');
                } else {
                    showMessage('请先将光标定位到一个列表块', true, 3000);
                    return;
                }

                // 创建一个包含当前块的数组
                blocks = [{ dataset: { nodeId: cursorElementId } }];
            }
        }
        // 绑定块
        if(isBindBlock){
            const blockIds = [...blocks].map(block => block.dataset.nodeId);
            // 绑定块（要用await等待插入完成，否则后面的读取操作可能读不到数据）
            await addBlocksToAv(blockIds, avId, toAvBlockId);
            // 添加数据库其他属性
            if(isEnableMoreCols && otherCols && otherCols.length > 0) {
                // 通过字段名获取keyID
                const keys = await requestApi("/api/av/getAttributeViewKeysByAvID", {avID:avId});
                otherCols.forEach(col => {
                    if(!col.colName) return;
                    const keyID = keys?.data?.find(item=>item.name === col.colName.trim())?.id;
                    if(!keyID) return;
                    col.keyID = keyID;
                });
                // 添加属性到数据库
                await addColsToAv(blockIds, otherCols, avId);
            }
            // 给选中块添加自定义属性
            if(isEnableCustomAttrsInSelectedBlock) await setBlocksAttrs(blockIds, customAttrs);
        }
        // 非绑定块
        else {
            // 通过字段名获取keyID
            const keys = await requestApi("/api/av/getAttributeViewKeysByAvID", {avID:avId});
            // 获取主键id
            let pkKeyID = keys?.data[0]?.id || '';
            if(!pkKeyID) {
                pkKeyID = keys?.data?.find(item=>item.type === 'block')?.id;
            }
            // 获取指定字段id
            let keyID = '';
            if(toAvColName) {
                keyID = keys?.data?.find(item=>item.name === toAvColName.trim())?.id;
            }
            // 其他扩展字段
            if(isEnableMoreCols && otherCols && otherCols.length > 0) {
                otherCols.forEach(col => {
                    if(!col.colName) return;
                    const keyID = keys?.data?.find(item=>item.name === col.colName.trim())?.id;
                    if(!keyID) return;
                    col.keyID = keyID;
                });
            }
            await addBlocksToAvNoBind(blocks, avId, pkKeyID, keyID, otherCols);

            // 给选中块添加自定义属性
            const blockIds = [...blocks].map(block => block.dataset.nodeId);
            if(isEnableCustomAttrsInSelectedBlock) await setBlocksAttrs(blockIds, customAttrs);
        }
    }
    // 通过块id获取数据库id
    async function getAvIdByAvBlockId(blockId) {
        const av = await getAvBySql(`SELECT * FROM blocks where type ='av' and id='${blockId}'`);
        if(av.length === 0) return '';
        const avId = av.map(av => getDataAvIdFromHtml(av.markdown))[0];
        return avId || '';
    }
    // 从数据库HTML代码中获取数据库id
    function getDataAvIdFromHtml(htmlString) {
        // 使用正则表达式匹配data-av-id的值
        const match = htmlString.match(/data-av-id="([^"]+)"/);
        if (match && match[1]) {
        return match[1];  // 返回匹配的值
        }
        return "";  // 如果没有找到匹配项，则返回空
    }
    // 通过sql获取数据库信息
    async function getAvBySql(sql) {
        const result = await requestApi('/api/query/sql', {"stmt": sql});
        if(result.code !== 0){
            console.error("查询数据库出错", result.msg);
            return [];
        }
        return result.data;
    }
    // 根据块 ID 获取块信息
    async function getBlockByID(blockId) {
        const sqlScript = `select * from blocks where id ='${blockId}'`;
        const data = await getAvBySql(sqlScript);
        return data[0];
    }
    // 插入块到数据库
    async function addBlocksToAv(blockIds, avId, avBlockID) {
        blockIds = typeof blockIds === 'string' ? [blockIds] : blockIds;
        const srcs = blockIds.map(blockId => ({
            "id": blockId,
            "itemID": blockId,
            "isDetached": false,
        }));
        const input = {
          "avID": avId,
          "blockID": avBlockID,
          'srcs': srcs
        }
        const result = await requestApi('/api/av/addAttributeViewBlocks', input);
        if(!result || result.code !== 0) console.error(result);
    }
    // 添加数据库属性
    // 对于绑定块，块/文档id === rowID
    async function addColsToAv(blockIds, cols, avID) {
        blockIds = typeof blockIds === 'string' ? [blockIds] : blockIds;
        for(const blockId of blockIds) {
            for(const col of cols) {
                if(!col.keyID) continue;
                const { cellID, values } = await getCellIdByRowIdAndKeyId(blockId, col.keyID, avID);
                if(!cellID) continue;
                let colData = {avID: avID, keyID: col.keyID, rowID: blockId, cellID};
                if(typeof col.getColValue !== 'function') continue;
                const colValue = await col.getColValue(col.keyID, blockId, cellID, avID, values);;
                if(typeof colValue !== 'object') continue;
                colData.value = colValue;
                const result = await requestApi("/api/av/setAttributeViewBlockAttr", colData);
                if(!result || result.code !== 0) console.error(result);
            }
        }
    }
    // 获取cellID
    // 对于绑定块，块/文档id === rowID
    // Cache for attribute view keys to avoid repeated API calls
    const avKeysCache = new Map();
    const CACHE_TIMEOUT = 5000; // 缓存有效期5秒

    async function getCellIdByRowIdAndKeyId(rowID, keyID, avID) {
        try {
            const cacheKey = `${rowID}-${avID}`;
            const now = Date.now();

            // 检查缓存是否存在且未过期
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
    }

    // 在数据更新后清除相关缓存
    function clearCache(rowID, avID) {
        const cacheKey = `${rowID}-${avID}`;
        avKeysCache.delete(cacheKey);
    }

    // 插入块到数据库(非绑定)
    async function addBlocksToAvNoBind(blocks, avId, pkKeyID, keyID, otherCols) {
        const values = await Promise.all([...blocks].map(async block => {
            // 必须添加主键列
            const rowValues = [{
                "keyID": pkKeyID,
                "block": {
                  "content": keyID ? "" : block.textContent
                }
            }];
            if(keyID) {
                rowValues.push({
                    "keyID": keyID,
                    "text": {
                      "content": block.textContent
                    }
                });
            }
            if(isEnableMoreCols && otherCols && otherCols.length > 0) {
                for(const col of otherCols){
                    if(!col.keyID) continue;
                    let colData = {"keyID": col.keyID};
                    if(typeof col.getColValue !== 'function') continue;
                    const colValue = await col.getColValue(col.keyID);
                    if(typeof colValue !== 'object') continue;
                    colData = {...colData, ...colValue};
                    rowValues.push(colData);
                }
            }
            return rowValues;
        }));
        const input = {
          "avID": avId,
          "blocksValues": values,
        }
        const result = await requestApi('/api/av/appendAttributeViewDetachedBlocksWithValues', input);
        if(!result || result.code !== 0) console.error(result);
    }

    // 给块添加自定义属性
    async function setBlocksAttrs(blockIds, attrs) {
        if(typeof attrs !== 'object') return;
        for(const blockId of blockIds) {
            if(!blockId) continue;
            const result = await requestApi('/api/attr/setBlockAttrs', {
                "id": blockId,
                "attrs": attrs
            });
            if(!result || result.code !== 0) console.error(result);
        }
    }

    // 请求api
    async function requestApi(url, data, method = 'POST') {
        return await (await fetch(url, {method: method, body: JSON.stringify(data||{})})).json();
    }

    /**
     * 监控 body 直接子元素中 #commonMenu 的添加
     * @returns {MutationObserver} 返回 MutationObserver 实例，便于后续断开监听
     */
    function observeBlockMenu(selector, callback) {
        let hasFlag1 = false;
        let hasFlag2 = false;
        let isTitleMenu = false;
        // 创建一个 MutationObserver 实例
        const observer = new MutationObserver((mutationsList) => {
            // 遍历所有变化
            for (const mutation of mutationsList) {
                // 检查是否有节点被添加
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // 遍历所有添加的节点
                    mutation.addedNodes.forEach((node) => {
                        // 检查节点是否是目标菜单
                        if((hasFlag1 && hasFlag2) || isTitleMenu) return;
                        if (node.nodeType === 1 && node.querySelector('.b3-menu__label')?.textContent?.trim() === window.siyuan.languages.cut) {
                            hasFlag1 = true;
                        }
                        if (node.nodeType === 1 && node.querySelector('.b3-menu__label')?.textContent?.trim() === window.siyuan.languages.move) {
                            hasFlag2 = true;
                        }
                        if(node.nodeType === 1 && node.closest('[data-name="titleMenu"]')) {
                            isTitleMenu = true;
                        }
                        if((hasFlag1 && hasFlag2) || isTitleMenu) {
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

        // 开始观察 body 的直接子元素的变化
        observer.observe(selector || document.body, {
            childList: true, // 监听子节点的添加
            subtree: false, // 仅监听直接子元素，不监听子孙元素
        });

        // 返回 observer 实例，便于后续断开监听
        return observer;
    }

    // 等待元素出现
    function whenElementExist(selector, node) {
        return new Promise(resolve => {
            const check = () => {
                const el = typeof selector==='function'?selector():(node||document).querySelector(selector);
                if (el) resolve(el); else requestAnimationFrame(check);
            };
            check();
        });
    }

    function showMessage(message, isError = false, delay = 7000) {
        return fetch('/api/notification/' + (isError ? 'pushErrMsg' : 'pushMsg'), {
            "method": "POST",
            "body": JSON.stringify({"msg": message, "timeout": delay})
        });
    }
})();