import MCData from "../../utils/mcdata.js";
import * as world from "./world.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';


export function log(bot, message, chat=false) {
    bot.output += message + '\n';
    if (chat)
        bot.chat(message);
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

async function equipHighestAttack(bot) {
    let weapons = bot.inventory.items().filter(item => item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe')));
    if (weapons.length === 0)
        weapons = bot.inventory.items().filter(item => item.name.includes('pickaxe') || item.name.includes('shovel'));
    if (weapons.length === 0)
        return;
    weapons.sort((a, b) => a.attackDamage < b.attackDamage);
    let weapon = weapons[0];
    if (weapon)
        await bot.equip(weapon, 'hand');
}


export async function craftRecipe(bot, itemName, num=1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    let placedTable = false;

    // get recipes that don't require a crafting table
    let recipes = bot.recipesFor(MCData.getInstance().getItemId(itemName), null, 1, null); 
    let craftingTable = null;
    if (!recipes || recipes.length === 0) {

        // Look for crafting table
        craftingTable = world.getNearestBlock(bot, 'crafting_table', 8);
        if (craftingTable === null){

            // Try to place crafting table
            let hasTable = world.getInventoryCounts(bot)['crafting_table'] > 0;
            if (hasTable) {
                let pos = world.getNearestFreeSpace(bot, 1, 6);
                await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
                craftingTable = world.getNearestBlock(bot, 'crafting_table', 8);
                if (craftingTable) {
                    recipes = bot.recipesFor(MCData.getInstance().getItemId(itemName), null, 1, craftingTable);
                    placedTable = true;
                }
            }
            else {
                log(bot, `You either do not have enough resources to craft ${itemName} or it requires a crafting table.`)
                return false;
            }
        }
        else {
            recipes = bot.recipesFor(MCData.getInstance().getItemId(itemName), null, 1, craftingTable);
        }
    }
    if (!recipes || recipes.length === 0) {
        log(bot, `You do not have the resources to craft a ${itemName}.`);
        if (placedTable) {
            await collectBlock(bot, 'crafting_table', 1);
        }
        return false;
    }

    const recipe = recipes[0];
    const actualNum = Math.ceil(num / recipe.result.count); // Adjust num based on recipe result count
    await bot.craft(recipe, actualNum, craftingTable);
    log(bot, `Successfully crafted ${itemName}, you now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    if (placedTable) {
        await collectBlock(bot, 'crafting_table', 1);
    }
    return true;
}


export async function smeltItem(bot, itemName, num=1) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/
    const foods = ['beef', 'chicken', 'cod', 'mutton', 'porkchop', 'rabbit', 'salmon', 'tropical_fish'];
    if (!itemName.includes('raw') && !foods.includes(itemName)) {
        log(bot, `Cannot smelt ${itemName}, must be a "raw" item, like "raw_iron".`);
        return false;
    } // TODO: allow cobblestone, sand, clay, etc.

    let placedFurnace = false;
    let furnaceBlock = undefined;
    furnaceBlock = world.getNearestBlock(bot, 'furnace', 6);
    if (!furnaceBlock){
        // Try to place furnace
        let hasFurnace = world.getInventoryCounts(bot)['furnace'] > 0;
        if (hasFurnace) {
            let pos = world.getNearestFreeSpace(bot, 1, 6);
            await placeBlock(bot, 'furnace', pos.x, pos.y, pos.z);
            furnaceBlock = world.getNearestBlock(bot, 'furnace', 6);
            placedFurnace = true;
        }
    }
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby and you have no furnace.`)
        return false;
    }
    await bot.lookAt(furnaceBlock.position);

    console.log('smelting...');
    const furnace = await bot.openFurnace(furnaceBlock);
    // check if the furnace is already smelting something
    let input_item = furnace.inputItem();
    if (input_item && input_item.type !== MCData.getInstance().getItemId(itemName) && input_item.count > 0) {
        // TODO: check if furnace is currently burning fuel. furnace.fuel is always null, I think there is a bug.
        // This only checks if the furnace has an input item, but it may not be smelting it and should be cleared.
        log(bot, `The furnace is currently smelting ${MCData.getInstance().getItemName(input_item.type)}.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }
    // check if the bot has enough items to smelt
    let inv_counts = world.getInventoryCounts(bot);
    if (!inv_counts[itemName] || inv_counts[itemName] < num) {
        log(bot, `You do not have enough ${itemName} to smelt.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }

    // fuel the furnace
    if (!furnace.fuelItem()) {
        let fuel = bot.inventory.items().find(item => item.name === 'coal' || item.name === 'charcoal');
        let put_fuel = Math.ceil(num / 8);
        if (!fuel || fuel.count < put_fuel) {
            log(bot, `You do not have enough coal or charcoal to smelt ${num} ${itemName}, you need ${put_fuel} coal or charcoal`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        await furnace.putFuel(fuel.type, null, put_fuel);
        log(bot, `Added ${put_fuel} ${MCData.getInstance().getItemName(fuel.type)} to furnace fuel.`);
        console.log(`Added ${put_fuel} ${MCData.getInstance().getItemName(fuel.type)} to furnace fuel.`)
    }
    // put the items in the furnace
    await furnace.putInput(MCData.getInstance().getItemId(itemName), null, num);
    // wait for the items to smelt
    let total = 0;
    let collected_last = true;
    let smelted_item = null;
    await new Promise(resolve => setTimeout(resolve, 200));
    while (total < num) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.log('checking...');
        let collected = false;
        if (furnace.outputItem()) {
            smelted_item = await furnace.takeOutput();
            if (smelted_item) {
                total += smelted_item.count;
                collected = true;
            }
        }
        if (!collected && !collected_last) {
            break; // if nothing was collected this time or last time
        }
        collected_last = collected;
        if (bot.interrupt_code) {
            break;
        }
    }

    if (placedFurnace) {
        await collectBlock(bot, 'furnace', 1);
    }
    if (total === 0) {
        log(bot, `Failed to smelt ${itemName}.`);
        return false;
    }
    if (total < num) {
        log(bot, `Only smelted ${total} ${MCData.getInstance().getItemName(smelted_item.type)}.`);
        return false;
    }
    log(bot, `Successfully smelted ${itemName}, got ${total} ${MCData.getInstance().getItemName(smelted_item.type)}.`);
    return true;
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    let furnaceBlock = world.getNearestBlock(bot, 'furnace', 6); 
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby.`)
        return false;
    }

    console.log('clearing furnace...');
    const furnace = await bot.openFurnace(furnaceBlock);
    console.log('opened furnace...')
    // take the items out of the furnace
    let smelted_item, intput_item, fuel_item;
    if (furnace.outputItem())
        smelted_item = await furnace.takeOutput();
    if (furnace.inputItem())
        intput_item = await furnace.takeInput();
    if (furnace.fuelItem())
        fuel_item = await furnace.takeFuel();
    console.log(smelted_item, intput_item, fuel_item)
    let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
    let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
    let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
    log(bot, `Cleared furnace, recieved ${smelted_name}, ${input_name}, and ${fuel_name}.`);
    return true;

}


export async function attackNearest(bot, mobType, kill=true, isPlayer=false) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    const nearbyEntities = world.getNearbyEntities(bot, 24);
    let mob;
    if (isPlayer) {
        mob = nearbyEntities.find(entity => entity !== bot.entity && entity.type === 'player' && entity.username === mobType);
    } else {
        mob = nearbyEntities.find(entity => entity !== bot.entity && entity.name === mobType);
    }
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, `Could not find any ${isPlayer ? 'player' : 'mob'} named ${mobType} to attack.`);
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    let pos = entity.position;
    console.log(bot.entity.position.distanceTo(pos))

    await equipHighestAttack(bot)

    if (!kill) {
        if (bot.entity.position.distanceTo(pos) > 4) {
            console.log('moving to mob...')
            await goToPosition(bot, pos.x, pos.y, pos.z);
        }
        console.log('attacking mob...')
        await bot.attack(entity);
    }
    else {
        bot.pvp.attack(entity);
        while (world.getNearbyEntities(bot, 24).includes(entity)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (bot.interrupt_code) {
                bot.pvp.stop();
                return false;
            }
        }
        log(bot, `Successfully killed ${entity.name}.`);
        await pickupNearbyItems(bot);
        return true;
    }
}

export async function defendSelf(bot, range=9) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 8.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let attacked = false;
    let enemy = world.getNearestEntityWhere(bot, entity => MCData.getInstance().isHostile(entity), range);
    while (enemy) {
        await equipHighestAttack(bot);
        if (bot.entity.position.distanceTo(enemy.position) > 4 && enemy.name !== 'creeper' && enemy.name !== 'phantom') {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                await bot.pathfinder.goto(new pf.goals.GoalFollow(enemy, 2), true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        bot.pvp.attack(enemy);
        attacked = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => MCData.getInstance().isHostile(entity), range);
        if (bot.interrupt_code) {
            bot.pvp.stop();
            return false;
        }
    }
    bot.pvp.stop();
    if (attacked)
        log(bot, `Successfully defended self.`);
    else
        log(bot, `No enemies nearby to defend self from.`);
    return attacked;
}



export async function collectBlock(bot, blockType, num=1, exclude=null) {
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    // Define common block types where the block and drop are different
    const blockDropMap = {
        'stone': ['cobblestone'],
        'coal_ore': ['coal', 'deepslate_coal_ore'],
        'iron_ore': ['raw_iron', 'deepslate_iron_ore'],
        'gold_ore': ['raw_gold', 'deepslate_gold_ore'],
        'diamond_ore': ['diamond', 'deepslate_diamond_ore'],
        'redstone_ore': ['redstone', 'deepslate_redstone_ore'],
        'lapis_ore': ['lapis_lazuli', 'deepslate_lapis_ore'],
        'emerald_ore': ['emerald', 'deepslate_emerald_ore'],
        'nether_quartz_ore': ['quartz'],
        'grass_block': ['dirt'],
        'gravel': ['flint'],
        'snow': ['snowball'],
        'clay': ['clay_ball'],
        'glowstone': ['glowstone_dust'],
        'nether_gold_ore': ['gold_nugget'],
        'ancient_debris': ['netherite_scrap']
    };

    let blocktypes = [blockType];

    // Check if the requested block type has a different drop or deepslate variant
    if (blockDropMap[blockType]) {
        blocktypes = [...blocktypes, ...blockDropMap[blockType]];
    }

    // Check if we're looking for a drop instead of a block
    for (const [block, drops] of Object.entries(blockDropMap)) {
        if (drops.includes(blockType)) {
            blocktypes.push(block);
        }
    }

    // Remove duplicates
    blocktypes = [...new Set(blocktypes)];

    let collected = 0;
    let retries = 0;

    console.log("starting collect loop");

    while (collected < num && retries < 10) {
        console.log(`Attempt ${retries + 1}: Collected ${collected}/${num} ${blockType}`);
        
        let blocks = world.getNearestBlocks(bot, blocktypes, 128);
        console.log(`Found ${blocks.length} blocks of type ${blockType}`);

        if (exclude) {
            for (let position of exclude) {
                blocks = blocks.filter(
                    block => block.position.x !== position.x || block.position.y !== position.y || block.position.z !== position.z
                );
            }
            console.log(`Excluded positions, ${blocks.length} blocks remaining`);
        }

        if (blocks.length === 0) {
            retries++;
            // Move around a tiny bit
            const pos = bot.entity.position;
            const randomOffset = () => (Math.random() - 0.5) * 2; // Random offset between -1 and 1
            await goToPosition(bot, pos.x + randomOffset(), pos.y, pos.z + randomOffset(), 1);
            console.log("No blocks found, moving and retrying");
            continue;
        }

        const block = blocks[0];
        console.log(`Attempting to collect block at ${block.position}`);

        await bot.tool.equipForBlock(block);
        const itemId = bot.heldItem ? bot.heldItem.type : null;
        console.log('Held item:', JSON.stringify(bot.heldItem, null, 2));
        if (!block.canHarvest(itemId)) {
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }

        try {
            await bot.collectBlock.collect(block);
            collected++;
            console.log(`Successfully collected block at ${block.position}`);
            await autoLight(bot);
        } catch (err) {
            console.log(`Error collecting block at ${block.position}: ${err.message}`);
            console.log('Stack trace:', err.stack);
            if (err.name === 'NoChests') {
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                break;
            } else {
                retries++;
                continue;
            }
        }

        if (bot.interrupt_code) break;
    }

    log(bot, `Collected ${collected} ${blockType}.`);
    return collected > 0;
}

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const distance = 8;
    const getNearestItem = bot => bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) < distance);
    let nearestItem = getNearestItem(bot);
    let pickedUp = 0;
    while (nearestItem) {
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalFollow(nearestItem, 0.8), true);
        await new Promise(resolve => setTimeout(resolve, 200));
        let prev = nearestItem;
        nearestItem = getNearestItem(bot);
        if (prev === nearestItem) {
            break;
        }
        pickedUp++;
    }
    log(bot, `Picked up ${pickedUp} items.`);
    return true;
}


export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (x == null || y == null || z == null) throw new Error('Invalid position to break block at.');
    let block = bot.blockAt(Vec3(x, y, z));
    if (block.name !== 'air' && block.name !== 'water' && block.name !== 'lava') {
        if (bot.modes.isOn('cheat')) {
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            let movements = new pf.Movements(bot);
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            bot.pathfinder.setMovements(movements);
            await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        }
        if (bot.game.gameMode !== 'creative') {
            await bot.tool.equipForBlock(block);
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        await bot.dig(block, true);
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    else {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}


export async function placeBlock(bot, blockType, x, y, z, placeOn='bottom', dontCheat=false) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    if (!MCData.getInstance().getBlockId(blockType)) {
        log(bot, `Invalid block type: ${blockType}.`);
        return false;
    }

    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    if (bot.modes.isOn('cheat') && !dontCheat) {
        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // insert wall_ before torch
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }

        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door'))
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        if (blockType.includes('bed'))
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        log(bot, `Used /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    let block = bot.inventory.items().find(item => item.name === blockType);
    if (!block && bot.game.gameMode === 'creative') {
        await bot.creative.setInventorySlot(36, MCData.getInstance().makeItem(blockType, 1)); // 36 is first hotbar slot
        block = bot.inventory.items().find(item => item.name === blockType);
    }
    if (!block) {
        log(bot, `Don't have any ${blockType} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (targetBlock.name === blockType) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern'];
    if (!empty_blocks.includes(targetBlock.name)) {
        log(bot, `${blockType} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (!empty_blocks.includes(block.name)) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket'];
    if (!dont_move_for.includes(blockType) && (pos.distanceTo(targetBlock.position) < 1 || pos_above.distanceTo(targetBlock.position) < 1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(inverted_goal);
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        let movements = new pf.Movements(bot);
        bot.pathfinder.setMovements(movements);
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    
    await bot.equip(block, 'hand');
    await bot.lookAt(buildOffBlock.position);

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        await bot.placeBlock(buildOffBlock, faceVec);
        log(bot, `Successfully placed ${blockType} at ${target_dest}.`);
        await new Promise(resolve => setTimeout(resolve, 200));
        return true;
    } catch (err) {
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function equip(bot, itemName, bodyPart) {
    /**
     * Equip the given item to the given body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @param {string} bodyPart, the body part to equip the item to.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe", "hand");
     * await skills.equip(bot, "diamond_chestplate", "torso");
     **/
    let item = bot.inventory.items().find(item => item.name === itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to equip.`);
        return false;
    }
    await bot.equip(item, bodyPart);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = bot.inventory.items().find(item => item.name === itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Successfully discarded ${discarded} ${itemName}.`);
    return true;
}

export async function eat(bot, foodName="") {
    /**
     * Eat the given item. If no item is given, it will eat the first food item in the bot's inventory.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} item, the item to eat.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (foodName) {
        item = bot.inventory.items().find(item => item.name === foodName);
        name = foodName;
    }
    else {
        item = bot.inventory.items().find(item => item.foodRecovery > 0);
        name = "food";
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    await bot.equip(item, 'hand');
    await bot.consume();
    log(bot, `Successfully ate ${item.name}.`);
    return true;
}


export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    let player = bot.players[username].entity
    if (!player){
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username);
    await bot.lookAt(player.position);
    discard(bot, itemType, num);
    return true;
}


export async function goToPosition(bot, x, y, z, min_distance=2) {
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    if (x == null || y == null || z == null) {
        log(bot, `Missing coordinates, given x:${x} y:${y} z:${z}`);
        return false;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        log(bot, `Teleported to ${x}, ${y}, ${z}.`);
        return true;
    }
    bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(new pf.goals.GoalNear(x, y, z, min_distance));
    log(bot, `You have reached at ${x}, ${y}, ${z}.`);
    return true;
}


export async function goToPlayer(bot, username, distance=1) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
     **/

    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let player = bot.players[username]?.entity;
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }

    const move = new pf.Movements(bot);
    bot.pathfinder.setMovements(move);
    await bot.pathfinder.goto(new pf.goals.GoalFollow(player, distance), true);

    log(bot, `You have reached ${username}.`);
}

export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    let player = bot.players[username].entity
    if (!player)
        return false;

    const move = new pf.Movements(bot);
    bot.pathfinder.setMovements(move);
    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    log(bot, `You are now actively following player ${username}.`);

    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return true;
}

export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position;
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));

    if (bot.modes.isOn('cheat')) {
        const path = await bot.pathfinder.getPathTo(move, inverted_goal, 10000);
        let last_move = path.path[path.path.length-1];
        console.log(last_move);
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            return true;
        }
    }

    await bot.pathfinder.goto(inverted_goal);
    let new_pos = bot.entity.position;
    log(bot, `Moved away from nearest entity to ${new_pos}.`);
    return true;
}

export async function avoidEnemies(bot, distance=16) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    bot.modes.pause('self_preservation'); // prevents damage-on-low-health from interrupting the bot
    let enemy = world.getNearestEntityWhere(bot, entity => MCData.getInstance().isHostile(entity), distance);
    while (enemy) {
        const follow = new pf.goals.GoalFollow(enemy, distance+1); // move a little further away
        const inverted_goal = new pf.goals.GoalInvert(follow);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        bot.pathfinder.setGoal(inverted_goal, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => MCData.getInstance().isHostile(entity), distance);
        if (bot.interrupt_code) {
            break;
        }
    }
    bot.pathfinder.stop();
    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function stay(bot) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    if (!door_pos) {
        for (let door_type of ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
                               'mangrove_door', 'cherry_door', 'bamboo_door', 'crimson_door', 'warped_door']) {
            door_pos = world.getNearestBlock(bot, door_type, 16).position;
            if (door_pos) break;
        }
    } else {
        door_pos = Vec3(door_pos.x, door_pos.y, door_pos.z);
    }
    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    bot.pathfinder.setGoal(new pf.goals.GoalNear(door_pos.x, door_pos.y, door_pos.z, 1));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (bot.pathfinder.isMoving()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    let door_block = bot.blockAt(door_pos);
    await bot.lookAt(door_pos);
    if (!door_block._properties.open)
        await bot.activateBlock(door_block);
    
    bot.setControlState("forward", true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    bot.setControlState("forward", false);
    await bot.activateBlock(door_block);

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => {
            return block.name.includes('bed');
        },
        maxDistance: 32,
        count: 1
    });
    if (beds.length === 0) {
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    await bot.sleep(bed);
    log(bot, `You are in bed.`);
    while (bot.isSleeping) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.till(bot, position.x, position.y - 1, position.x);
     **/
    console.log(x, y, z)
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    let block = bot.blockAt(new Vec3(x, y, z));
    console.log(x, y, z)
    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        log(bot, `Cannot till, there is ${above.name} above the block.`);
        return false;
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        if (!hoe) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.equip(hoe, 'hand');
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let seeds = bot.inventory.items().find(item => item.name === seedType);
        if (!seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }
        await bot.equip(seeds, 'hand');

        await bot.placeBlock(block, new Vec3(0, -1, 0));
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

export async function activateItem(bot, offHand = false) {
    /**
     * Activates the currently held item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {boolean} offHand, whether to activate the item in the off hand. Defaults to false (main hand).
     * @returns {Promise<boolean>} true if the item was activated, false if there was an error.
     * @example
     * await skills.activateItem(bot);
     * await skills.activateItem(bot, true); // activate off-hand item
     **/
    try {
        // TODO: not working for spawn eggs
        await bot.activateItem(offHand);
        const handName = offHand ? "off hand" : "main hand";
        log(bot, `Activated item in ${handName}.`);
        return true;
    } catch (error) {
        log(bot, `Failed to activate item: ${error.message}`);
        return false;
    }
}

export async function activateNearestEntity(bot, entityType) {
    /**
     * Activate the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to activate.
     * @returns {Promise<boolean>} true if the entity was activated, false otherwise.
     * @example
     * await skills.activateNearestEntity(bot, "villager");
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, 16);
    if (!entity) {
        log(bot, `Could not find any ${entityType} to activate.`);
        return false;
    }
    if (entity === bot.vehicle) {
        log(bot, `Already riding the nearest ${entityType}.`);
        return false;
    }
    if (bot.entity.position.distanceTo(entity.position) > 4.5) {
        let pos = entity.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateEntity(entity);
    log(bot, `Activated ${entityType} at x:${entity.position.x.toFixed(1)}, y:${entity.position.y.toFixed(1)}, z:${entity.position.z.toFixed(1)}.`);
    return true;
}

export async function useOn(bot, targetEntity) {
    /**
     * Uses the currently held item on the specified entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} targetEntity, the entity to use the item on.
     * @returns {Promise<boolean>} true if the item was used on the entity, false otherwise.
     * @example
     * await skills.useOn(bot, targetEntity);
     **/
    if (!targetEntity) {
        log(bot, `No target entity specified.`);
        return false;
    }

    // Ensure the bot is close enough to the target entity
    const distance = bot.entity.position.distanceTo(targetEntity.position);
    if (distance > 4.5) {
        log(bot, `Target entity is too far away, moving closer...`);
        const move = new pf.Movements(bot);
        bot.pathfinder.setMovements(move);
        await bot.pathfinder.goto(new pf.goals.GoalFollow(targetEntity, 2));
    }

    // Ensure the bot is looking at the target entity
    await bot.lookAt(targetEntity.position);

    try {
        await bot.useOn(targetEntity);
        log(bot, `Successfully used item on ${targetEntity.name}.`);
        return true;
    } catch (err) {
        log(bot, `Failed to use item on ${targetEntity.name}: ${err.message}`);
        return false;
    }
}

export async function lookInChest(bot) {
    /**
     * Look in the nearest chest and log its contents.
     * @param {MinecraftBot} bot - Reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest contents were logged, false if no chest was found.
     * @example
     * await skills.lookInChest(bot);
     */
    const chestToOpen = bot.findBlock({
        matching: bot.registry.blocksByName.chest.id,
        maxDistance: 6
    });

    if (!chestToOpen) {
        log(bot, 'No chest found nearby.');
        return false;
    }

    const chest = await bot.openContainer(chestToOpen);
    const itemsInChest = chest.containerItems().map(item => `${item.name} x${item.count}`);
    
    if (itemsInChest.length === 0) {
        log(bot, 'The chest is empty.');
    } else {
        log(bot, 'Chest contents:');
        itemsInChest.forEach(item => log(bot, `- ${item}`));
    }

    chest.close();
    return true;
}

export async function depositToChest(bot, itemName, amount) {
    /**
     * Deposit the specified amount of items into the nearest chest.
     * @param {MinecraftBot} bot - Reference to the minecraft bot.
     * @param {string} itemName - The name of the item to deposit.
     * @param {number} amount - The amount of items to deposit.
     * @returns {Promise<boolean>} true if the items were deposited, false otherwise.
     * @example
     * await skills.depositToChest(bot, "oak_log", 10);
     */
    const chestToOpen = bot.findBlock({
        matching: bot.registry.blocksByName.chest.id,
        maxDistance: 6
    });

    if (!chestToOpen) {
        log(bot, 'No chest found');
        return false;
    }

    const chest = await bot.openContainer(chestToOpen);
    const itemsInChest = chest.containerItems().map(item => `${item.name} x${item.count}`).join(', ');
    log(bot, `Opened chest containing: ${itemsInChest}`);

    const item = bot.inventory.items().find(item => item.name === itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to deposit.`);
        chest.close();
        return false;
    }

    try {
        await chest.deposit(item.type, null, amount);
        log(bot, `Deposited ${amount} ${itemName}`);
        chest.close();
        return true;
    } catch (err) {
        log(bot, `Unable to deposit ${amount} ${itemName}`);
        chest.close();
        return false;
    }
}

export async function withdrawFromChest(bot, itemName, amount) {
    /**
     * Withdraw the specified amount of items from the nearest chest.
     * @param {MinecraftBot} bot - Reference to the minecraft bot.
     * @param {string} itemName - The name of the item to withdraw.
     * @param {number} amount - The amount of items to withdraw.
     * @returns {Promise<boolean>} true if the items were withdrawn, false otherwise.
     * @example
     * await skills.withdrawFromChest(bot, "oak_log", 10);
     */
    const chestToOpen = bot.findBlock({
        matching: bot.registry.blocksByName.chest.id,
        maxDistance: 6
    });

    if (!chestToOpen) {
        log(bot, 'No chest found');
        return false;
    }

    const chest = await bot.openContainer(chestToOpen);
    const itemsInChest = chest.containerItems().map(item => `${item.name} x${item.count}`).join(', ');
    log(bot, `Opened chest containing: ${itemsInChest}`);

    const item = chest.containerItems().find(item => item.name === itemName);
    if (!item) {
        log(bot, `No ${itemName} found in the chest.`);
        chest.close();
        return false;
    }

    try {
        await chest.withdraw(item.type, null, amount);
        log(bot, `Withdrew ${amount} ${itemName}`);
        chest.close();
        return true;
    } catch (err) {
        log(bot, `Unable to withdraw ${amount} ${itemName}`);
        chest.close();
        return false;
    }
}

export function startCrouching(bot) {
    /**
     * Start crouching.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @example
     * skills.startCrouching(bot);
     **/
    bot.pathfinder.sneak = true;
    log(bot, 'Started crouching.');
}

export function stopCrouching(bot) {
    /**
     * Stop crouching.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @example
     * skills.stopCrouching(bot);
     **/
    bot.pathfinder.sneak = false;
    log(bot, 'Stopped crouching.');
}

export async function consume(bot, itemName) {
    /**
     * Consume an item in the bot's inventory.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the name of the item to consume.
     * @returns {Promise<boolean>} true if the item was consumed, false otherwise.
     * @example
     * await skills.consume(bot, 'apple');
     **/
    const item = bot.inventory.items().find(item => item.name === itemName);
    if (!item) {
        log(bot, `No ${itemName} found in inventory.`);
        return false;
    }

    try {
        await bot.equip(item, 'hand');
        await bot.consume();
        log(bot, `Consumed ${itemName}`);
        return true;
    } catch (err) {
        log(bot, `Unable to consume ${itemName}: ${err.message}`);
        return false;
    }
}

export async function dismount(bot) {
    /**
     * Dismount the bot from any entity it is currently riding.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bot dismounted, false otherwise.
     * @example
     * await skills.dismount(bot);
     **/
    if (!bot.vehicle) {
        log(bot, 'The bot is not riding any entity.');
        return false;
    }

    try {
        await bot.dismount();
        log(bot, 'Successfully dismounted.');
        return true;
    } catch (err) {
        log(bot, `Failed to dismount: ${err.message}`);
        return false;
    }
}

