// V2 types — canonical source of truth
export * from './enums';       // AppRole, UserStatus, VerificationStatus, DocumentStatus, OfferRequestStatus, OfferStatus, CompanyMemberRole, SenderRole
export * from './catalog';     // TechnicianTypeCode, LicenseCode, ContractTypeCode, CompanyTypeCode, catalog interfaces
export * from './technician';  // TechnicianProfile, TechnicianWithRelations, TechnicianLicense, TechnicianHabilitation, SocialLinks, Availability, AvailabilityStatus + V1 compat kept alive on purpose (v2CompatAdapters.ts): Technician, SafeTechnicianView
export * from './privacy';     // SafeTechnicianPreview, UnlockedTechnicianView, TechnicianView, isUnlocked, TechnicianPublicPreviewDTO, TechnicianUnlockedDTO
export * from './company';     // CompanyProfile, CompanyMember + V1 compat: Company, CompanyType
export * from './offer';       // Offer, OfferWithRequirements
export * from './offerRequest'; // OfferRequest, OfferApplication, OfferInboxRecord
export * from './chat';        // ChatRoom, ChatMessage
export * from './document';    // Document, TechnicianDocument, DocumentType + V1 compat: TechnicianDocument
export * from './filters';     // TechnicianSearchFilters + V1 compat: TechnicianFilters, MapFilters
export * from './matching';    // MatchScore, MatchLabel, MatchLevel
export * from './catalogRequest'; // CatalogRequest, CatalogRequestStatus
export * from './habilitationScope'; // AircraftClass, PropulsionType, EasaGroup, HabilitationScope (Fase 4 scaffolding, unused by production code)

// V1 unchanged files
export * from './matchRequest'; // MatchRequest, MatchRequestStatus
