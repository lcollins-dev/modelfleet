import { InitialDBStructure1596747468000 } from './1596747468000-InitialDBStructure';
import { InitialDBEntries1596966611000 } from './1596966611000-InitialDBEntries';
import { FleetEventLog1787406233694 } from './1787406233694-FleetEventLog';
import { NodeRegistry1787429237390 } from './1787429237390-NodeRegistry';
import { GpuInventory1787680915423 } from './1787680915423-GpuInventory';
import { ModelCatalogue1787876731989 } from './1787876731989-ModelCatalogue';
import { PresetsAndDeployments1787956545921 } from './1787956545921-PresetsAndDeployments';
import { Instances1788031832310 } from './1788031832310-Instances';
import { InferenceApiKeys1788712352562 } from './1788712352562-InferenceApiKeys';
import { QuantisationFromTensorTypes1789901597404 } from './1789901597404-QuantisationFromTensorTypes';
import { DeploymentResidency1789901620070 } from './1789901620070-DeploymentResidency';
import { ModelTypes1789917785021 } from './1789917785021-ModelTypes';
import { InstancePins1789925018337 } from './1789925018337-InstancePins';
import { MeasuredVram1790107607024 } from './1790107607024-MeasuredVram';
import { LaunchFailures1790202260965 } from './1790202260965-LaunchFailures';
import { Downloads1790375628175 } from './1790375628175-Downloads';
import { ModelDisplayName1790462879121 } from './1790462879121-ModelDisplayName';
import { GpuIndex1791047309795 } from './1791047309795-GpuIndex';
import { ModelTasks1791638871138 } from './1791638871138-ModelTasks';
import { ModelTaskSets1791811670642 } from './1791811670642-ModelTaskSets';
import { VoiceLists1791827752265 } from './1791827752265-VoiceLists';
import { MustChangePassword1791903696040 } from './1791903696040-MustChangePassword';
import { BatchJobRuns1791920160755 } from './1791920160755-BatchJobRuns';
import { UnprefixedPageUrls1791933356935 } from './1791933356935-UnprefixedPageUrls';
import { VllmOmniMemoryGib1792014138968 } from './1792014138968-VllmOmniMemoryGib';
import { TestData9000000000000 } from './test/9000000000000-TestData';

export const migrations = [
  InitialDBStructure1596747468000,
  InitialDBEntries1596966611000,
  FleetEventLog1787406233694,
  NodeRegistry1787429237390,
  GpuInventory1787680915423,
  ModelCatalogue1787876731989,
  PresetsAndDeployments1787956545921,
  Instances1788031832310,
  InferenceApiKeys1788712352562,
  QuantisationFromTensorTypes1789901597404,
  DeploymentResidency1789901620070,
  ModelTypes1789917785021,
  InstancePins1789925018337,
  MeasuredVram1790107607024,
  LaunchFailures1790202260965,
  Downloads1790375628175,
  ModelDisplayName1790462879121,
  GpuIndex1791047309795,
  ModelTasks1791638871138,
  ModelTaskSets1791811670642,
  VoiceLists1791827752265,
  MustChangePassword1791903696040,
  BatchJobRuns1791920160755,
  UnprefixedPageUrls1791933356935,
  VllmOmniMemoryGib1792014138968,
];
export const testMigrations = [TestData9000000000000];
