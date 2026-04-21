
import 'dart:convert';

class AgentModel {
  final String name;
  final String creatorId;
  final String character;
  final String characterTags;
  final List<String> photoURLs;
  final int system;
  final int id;
  final String gender;
  final int age;
  final String? speakingStyle;
  final dynamic interests;
  final dynamic interestsType;
  final String? voiceId;
  final String country;
  final String? riveAvatar;
  final String? jobTr;
  final String? jobEn;
  final String? jobIt;
  final String? jobDe;
  final String? jobJa;
  final String? jobFr;
  final String? jobEs;
  final String? jobKo;
  final String? jobHi;
  final String? jobPt;
  AgentModel({
    required this.name,
    required this.creatorId,
    required this.character,
    required this.characterTags,
    required this.photoURLs,
    required this.system,
    required this.id,
    required this.gender,
    required this.age,
    required this.speakingStyle,
    required this.interests,
    required this.interestsType,
    required this.voiceId,
    required this.country,
    this.riveAvatar,
    this.jobTr,
    this.jobEn,
    this.jobIt,
    this.jobDe,
    this.jobJa,
    this.jobFr,
    this.jobEs,
    this.jobKo,
    this.jobHi,
    this.jobPt,
  });

  String get photoURL => photoURLs.isNotEmpty ? photoURLs.first : '';

  static const List<String> supportedJobLangs = [
    'tr', 'en', 'it', 'de', 'ja', 'fr', 'es', 'ko', 'hi', 'pt'
  ];

  String? getJobByLang(String? langCode) {
    final normalized = (langCode ?? 'en').toLowerCase().split('_').first.split('-').first;
    switch (normalized) {
      case 'tr':
        return jobTr ?? jobEn;
      case 'en':
        return jobEn ?? jobTr;
      case 'it':
        return jobIt ?? jobEn ?? jobTr;
      case 'de':
        return jobDe ?? jobEn ?? jobTr;
      case 'ja':
        return jobJa ?? jobEn ?? jobTr;
      case 'fr':
        return jobFr ?? jobEn ?? jobTr;
      case 'es':
        return jobEs ?? jobEn ?? jobTr;
      case 'ko':
        return jobKo ?? jobEn ?? jobTr;
      case 'hi':
        return jobHi ?? jobEn ?? jobTr;
      case 'pt':
        return jobPt ?? jobEn ?? jobTr;
      default:
        return jobEn ?? jobTr;
    }
  }

  Map<String, String?> get jobsByLanguage => {
    'tr': jobTr,
    'en': jobEn,
    'it': jobIt,
    'de': jobDe,
    'ja': jobJa,
    'fr': jobFr,
    'es': jobEs,
    'ko': jobKo,
    'hi': jobHi,
    'pt': jobPt,
  };


  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'name': name,
      'creatorId': creatorId,
      'character': character,
      'characterTags': characterTags,
      'photoURL': photoURL,
      'photoURLs': photoURLs,
      'system': system,
      'id': id,
      'gender': gender,
      'age': age,
      'speakingStyle': speakingStyle,
      'interests': interests,
      'interestsType': interestsType,
      'voiceId': voiceId,
      'country': country,
      'rive_avatar': riveAvatar,
      'job_tr': jobTr,
      'job_en': jobEn,
      'job_it': jobIt,
      'job_de': jobDe,
      'job_ja': jobJa,
      'job_fr': jobFr,
      'job_es': jobEs,
      'job_ko': jobKo,
      'job_hi': jobHi,
      'job_pt': jobPt,

    };
  }

  factory AgentModel.fromMap(Map<String, dynamic> map) {
    return AgentModel(
      id: map["id"],
      name: map['name'] as String,
      creatorId: map['creatorId'] as String,
      character: map['character'] as String,
      characterTags: map['characterTags'] as dynamic,
      photoURLs: _parsePhotoUrls(map),
      system: map['system'] as int,
      gender: map['gender'] as String,
      age: map['age'] as int,
      speakingStyle: map['speakingStyle'],
      interests: map['interests'] as dynamic,
      interestsType: map['interestsType'] as dynamic,
      voiceId: map['voiceId'],
      country: map['country'] as String,
      riveAvatar: map['rive_avatar'],
      jobTr: map['job_tr'],
      jobEn: map['job_en'],
      jobIt: map['job_it'],
      jobDe: map['job_de'],
      jobJa: map['job_ja'],
      jobFr: map['job_fr'],
      jobEs: map['job_es'],
      jobKo: map['job_ko'],
      jobHi: map['job_hi'],
      jobPt: map['job_pt'],
    );
  }

  static List<String> _parsePhotoUrls(Map<String, dynamic> map) {
    final dynamic raw = map['photoURLs'] ?? map['photo_urls'] ?? map['photoURL'];
    if (raw == null) {
      return const [];
    }
    if (raw is List) {
      return raw.whereType<String>().where((e) => e.trim().isNotEmpty).toList();
    }
    if (raw is String) {
      final trimmed = raw.trim();
      if (trimmed.isEmpty) {
        return const [];
      }
      if (trimmed.startsWith('[')) {
        try {
          final dynamic parsed = jsonDecode(trimmed);
          if (parsed is List) {
            return parsed.whereType<String>().where((e) => e.trim().isNotEmpty).toList();
          }
        } catch (_) {
          return [trimmed];
        }
      }
      return [trimmed];
    }
    return const [];
  }
}
