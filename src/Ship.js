
import { clone, cloneDeep, map, chain, sortBy } from 'lodash';
import autoBind from 'auto-bind';
import { validateShipJson, shipVarIsSpecified } from './validation';
import { compress, decompress } from './compression';
import Module, { ModuleLike } from './Module';
import { REG_HARDPOINT_SLOT, REG_INTERNAL_SLOT, REG_MILITARY_SLOT,
    REG_UTILITY_SLOT } from './data/slots';
import { ImportExportError, IllegalStateError } from './errors';

/**
 * @typedef {(string|RegExp)} Slot
 */

/**
 * @typedef {(Slot|number)} NumberedSlot
 */

function sortModules(modules) {
    return sortBy(modules, m => m._object.Slot);
}

/**
 * An Elite: Dangerous ship build.
 */
class Ship {

    /**
     * @typedef {Object} ShipObject
     * @property {string} Ship
     * @property {string} ShipName
     * @property {string} ShipIdent
     * @property {Module[]} Modules
     */

    /**
     * @typedef {Object} DistributorSettingObject
     * @property {number} base
     * @property {number} mc
     */

    /**
     * @typedef {Object} DistributorStateObject
     * @property {DistributorSettingObject} Sys
     * @property {DistributorSettingObject} Eng
     * @property {DistributorSettingObject} Wep
     */

    /**
     * @typedef {Object} StateObject
     * @property {DistributorStateObject} PowerDistributor
     * @property {number} Cargo
     * @property {number} Fuel
     */

    /**
     * @param {(string|Object)} buildFrom
     * @throws {ImportExportError} On invalid ship json.
     */
    constructor(buildFrom) {
        autoBind(this);
        /** @type {ShipObject} */
        this._object = null;
        /** @type {StateObject} */
        this.state = {
            PowerDistributor: {
                Sys: { base: 2, mc: 0, },
                Eng: { base: 2, mc: 0, },
                Wep: { base: 2, mc: 0, },
            },
            Cargo: 0,
            Fuel: 1,
        };

        if (typeof buildFrom === 'string') {
            buildFrom = decompress(buildFrom);
        }

        if (!validateShipJson(buildFrom)) {
            throw new ImportExportError('Ship build is not valid');
        }

        this._object = cloneDeep(buildFrom);
        this._object.Modules = map(
            this._object.Modules,
            moduleObject => new Module(moduleObject, this)
        );
    }

    /**
     * Read an arbitrary object property of this ship's corresponding json.
     * @param {string} property
     * @return {*}
     */
    read(property) {
        return this._object[property];
    }

    /**
     * Write an arbitrary value to an arbitrary object property of this ship's
     * corresponding json. Fields that are required to be set on valid builds
     * are protected and can only be written by invoking the corresponding
     * method, e.g. to alter the ship's name you can't invoke
     * `ship.write('ShipName', 'Normandy')` but must invoke
     * `ship.setShipName('Normandy')`.
     * @throws {IllegalStateError} On an attempt to write a protected property.
     */
    write(property, value) {
        if (shipVarIsSpecified(property)) {
            throw new IllegalStateError(
                `Can't write protected property ${property}`
            );
        }
        this._object[property] = value;
    }

    /**
     * Get the module that sits on a matching slot. If `slot` is a string only
     * a module with the same slot name is matching. If `slot` is a RegExp the
     * first module that matches the RegExp is returned. Order is not
     * guaranteed.
     * @param {(string|RegExp)} slot The slot of the module.
     * @return {(Module|undefined)} Returns the first matching module or
     *                              undefined if no matching one can be found.
     */
    getModule(slot) {
        return chain(this._object.Modules)
            .filter(m => m.isOnSlot(slot))
            .head()
            .value();
    }

    /**
     * Sets given module on the first matching slot. Cf. {@see Ship.getModule}
     * for what a "matching slot" is. This function will copy the given module.
     * @param {(Slot|Module)} slot Slot to set the module on.
     * @param {ModuleLike} module Module to set.
     * @return {boolean} Returns whether an update took place.
     */
    setModule(slot, module) {
        if (slot instanceof Module) {
            slot.update(module, ['Slot']);
            return true;
        } else {
            let old = this.getModule(slot);
            if (old) {
                return this.setModule(old, module);
            }
        }

        return false;
    }

    /**
     * Gets a list of matching modules. Cf. {@see Ship.getModule} for what a
     * "matching module" is. Order of returned modules is not guaranteed unless
     * `slots` is an array then it is guaranteed for any slot with index i that
     * matching modules with that slot appear in the return value before slots
     * matching any slot with index > i. Duplicates are filtered.
     * @param {(Slot|Slot[])} slots Slots of the modules to get.
     * @return {Module[]} All matching modules. Possibly empty.
     */
    getModules(slots, type, includeEmpty, sort) {
        let ms = chain(this._object.Modules)
            .filter(module => module.isOnSlot(slots));

        if (type) {
            ms = ms.filter(m => m._object.Item.match(type));
        }
        if (!includeEmpty) {
            ms = ms.filter(m => !m.isEmpty());
        }
        if (sort) {
            ms = ms.sortBy();
        }

        return ms.uniq().value();
    }

    /**
     * @return {Module[]}
     */
    getCoreModules() {
        return [
            this.getAlloys(),
            this.getPowerPlant(),
            this.getThrusters(),
            this.getFSD(),
            this.getLifeSupport(),
            this.getPowerDistributor(),
            this.getSensors(),
            this.getCoreFuelTank()
        ];
    }

    /**
     * Sets all modules given that are core modules replacing old ones.
     * @param {ModuleLike[]} modules Core modules to set.
     * @return {boolean[]}  Array of boolean whether the corresponding
     *                      {@link ModuleLike} was set.
     */
    setCoreModules(modules) {
        return map(modules, module => this.setCoreModules([module]));
    }

    /**
     * Sets a given core module to this build.
     * @param {Module} module Core module to set.
     * @return {boolean} Returns whether an update has taken place.
     */
     setCoreModule(module) {
        if (!module instanceof Module) {
            module = new Module(module);
        }
        let slot = chain(CORE_MODULES)
            .filter(i_slot => module._object.Item.match(i_slot))
            .head()
            .value();
        if (slot) {
            return this.setModule(slot, module);
        }
        return false;
    }

    /**
     * Get the alloys of this ship.
     * @return {Module} Alloys
     */
    getAlloys() {
        return this.getModule('Armour');
    }

    /**
     * Get the power plant of this ship.
     * @return {Module} Power plant
     */
    getPowerPlant() {
        return this.getModule('PowerPlant');
    }

    /**
     * Get the thrusters of this ship.
     * @return {Module} Thrusters
     */
    getThrusters() {
        return this.getModule('MainEngines');
    }

    /**
     * Get the frame shift drive of this ship.
     * @return {Module} FSD
     */
    getFSD() {
        return this.getModule('FrameShiftDrive');
    }

    /**
     * Get the life support module of this ship.
     * @return {Module} Life support
     */
    getLifeSupport() {
        return this.getModule('LifeSupport');
    }

    /**
     * Get the power distributor of this ship.
     * @return {Module} Power distributor
     */
    getPowerDistributor() {
        return this.getModule('PowerDistributor');
    }

    /**
     * Get the sensors of this ship.
     * @return {Module} Sensors
     */
    getSensors() {
        return this.getModule('Radar');
    }

    /**
     * The core fuel tank of this ship.
     * @return {Module} Core fuel tank
     */
    getCoreFuelTank() {
        return this.getModule('FuelTank');
    }

    /**
     * Gets an array of internal modules from this ship. Return value is split
     * in normal and military slots. Normal slots come first. Each category is
     * sorted by the module's class in descending order with a fixed order on
     * modules of the same class (as ingame).
     * @param {RegExp} [type] Optional regex to constrain the type of modules to
     *                        be returned.
     * @param {boolean} [includeEmpty=false]    If set to true also empty slots
     *                                          will be returned, i.e. which are
     *                                          just a slot.
     * @return {Module[]} Array of internal modules. Possibly empty.
     */
    getInternals(type, includeEmpty) {
        let ms = this.getModules(REG_INTERNAL_SLOT, type, includeEmpty, true);
        let militaryMs = this.getModules(REG_MILITARY_SLOT, type, includeEmpty, true);
        return ms.concat(militaryMs);
    }

    /**
     * Sets a module to an internal slot. If `slot` is a number then `slot` is
     * interpreted as a zero based index to all internal modules as returned by
     * {@link Ship.getInternals} with empty modules included.
     * @param {NumberedSlot} slot Slot to place the module in.
     * @param {ModuleLike} module Module to add to the ship.
     * @return {boolean} Returns whether an update has taken place.
     */
    setInternal(slot, module) {
        if (typeof slot === 'number') {
            let internals = this.getInternals(undefined, true);
            slot = internals[slot]._object.Slot;
        }
        return this.setModule(slot, module);
    }

    /**
     * Returns hardpoint modules of this ship. Return values is ordered by
     * module class in ascending order first, then by a fixed order (as ingame).
     * @param {string} [type] Type to filter modules by.
     * @param {boolean} [includeEmpty=false]    If true, also empty modules will
     *                                          be returned, i.e. which are just
     *                                          a slot.
     * @return {Module[]} Hardpoint modules
     */
    getHardpoints(type, includeEmpty) {
        return this.getModules(REG_HARDPOINT_SLOT, type, includeEmpty, true);
    }

    /**
     * Sets a module to a hardpoint slot. If `slot` is a number then `slot` is
     * interpreted as a zero based index to all hardpoint modules as returned by
     * {@link Ship.getHardpoints} with empty modules included.
     * @param {NumberedSlot} slot Slot to set the module to
     * @param {ModuleLike} module Module to set
     * @return {boolean} Returns whether an update has taken place.
     */
    setHardpoint(slot, module) {
        if (typeof slot === 'number') {
            let hardpoints = this.getHardpoints(undefined, true);
            slot = hardpoints[slot]._object.Slot;
        }
        return this.setModule(slot, module);
    }

    /**
     * Returns all utility module in a fixed order (as ingame).
     * @param {string} [type] Type to filter modules by.
     * @param {boolean} [includeEmpty=false]    If true, also empty modules will
     *                                          be returned, i.e. which are just
     *                                          a slot.
     * @return {Module[]} Utility modules
     */
    getUtilities(type, includeEmpty) {
        return this.getModules(REG_UTILITY_SLOT, type, includeEmpty, true);
    }

    /**
     * Sets a module to a utility slot. If `slot` is a number then `slot` is
     * interpreted as a zero based index to all utility modules as returned by
     * {@link Ship.getUtilities} with empty modules included.
     * @param {NumberedSlot} slot Slot to set the module to
     * @param {ModuleLike} module Module to set
     * @return {boolean} Returns whether an update has taken place.
     */
    setUtility(slot, module) {
        if (typeof slot === 'number') {
            let utilities = this.getUtilities(undefined, true);
            slot = utilities[slot]._object.Slot;
        }
        return this.setModule(slot, module)
    }

    /**
     * @param {(string|ShipPropertyCalculator)} property
     * @param {boolean} [modified=true]
     * @return {number}
     */
    get(property, modified = true) {}

    /**
     * @return {string}
     */
    getShipName() {
        return this._object.ShipName;
    }

    /**
     * @param {string} name
     */
    setShipName(name) {
        this._object.ShipName = name;
    }

    /**
     * @return {string}
     */
    getShipID() {
        return this._object.ShipIdent;
    }

    /**
     * @param {string} id
     */
    setShipID(id) {
        this._object.ShipIdent = id;
    }

    /**
     * @param {string} property
     * @param {boolean} [modified=true]
     * @param {i18n.FormatOptions.SiUnit} [unit]
     * @param {number} [value]
     */
    getFormatted(property, modified = true, unit, value) {}

    /**
     * @param {string} statistics
     * @param {boolean} [modified=true]
     */
    getStatistics(statistics, modified = true) {}

    /**
     * @return {Object}
     */
    toJSON() {
        let _modules = this._object.Modules;
        this._object.Modules = map(_modules, m => m.toJSON());
        let r = clone(this._object);
        this._object.Modules = _modules;
        return r;
    }

    /**
     * @return {string}
     */
    compress() {
        return compress(this.toJSON());
    }
}

/** @module ed-forge */
export default Ship;
